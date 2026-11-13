-- 0003: commerce ledger (spec 5, 7).
--
-- transactions becomes an order header; what was bought, from whom and at
-- what price moves to transaction_items, snapshotted at checkout so later
-- catalogue edits never rewrite sales history. Access to a book is an
-- entitlement, granted only when a verified provider event confirms payment.
--
-- Fee model is undecided (see project decisions): per item we record gross,
-- tax, provider fee and the remaining net. Platform commission is added once
-- the rule is chosen, as new columns, without rewriting these.

-- Launch currency is EUR. Pre-launch rows were seeded in USD; nothing real
-- has been sold, so relabel them rather than carry two currencies.
ALTER TABLE books ALTER COLUMN currency SET DEFAULT 'EUR';
UPDATE books SET currency = 'EUR' WHERE currency <> 'EUR';
ALTER TABLE transactions ALTER COLUMN currency SET DEFAULT 'EUR';


-- ---------------------------------------------------------------------------
-- Transactions: order header
-- ---------------------------------------------------------------------------

ALTER TABLE transactions RENAME COLUMN payment_gateway_ref TO provider_transaction_id;
ALTER TABLE transactions RENAME COLUMN amount_cents TO total_cents;
ALTER TABLE transactions ALTER COLUMN total_cents TYPE BIGINT;
ALTER TABLE transactions RENAME CONSTRAINT amount_non_negative TO total_non_negative;

ALTER TABLE transactions
  -- Which adapter created it: 'simulated' (dev/test) or 'paddle'.
  ADD COLUMN provider TEXT NOT NULL DEFAULT 'simulated',
  -- Client-supplied retry key, unique per user.
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN checkout_url TEXT,
  -- Provider-reported money, set when payment is confirmed. tax is included
  -- in total (EU prices are VAT-inclusive); earnings = total - tax - fee.
  ADD COLUMN subtotal_cents     BIGINT,
  ADD COLUMN tax_cents          BIGINT,
  ADD COLUMN provider_fee_cents BIGINT,
  ADD COLUMN earnings_cents     BIGINT,
  ADD COLUMN paid_at            TIMESTAMPTZ,
  -- Set when something needs a human: amount mismatch, duplicate purchase,
  -- unmappable refund line. Never cleared automatically.
  ADD COLUMN review_reason TEXT;

ALTER TABLE transactions ALTER COLUMN provider DROP DEFAULT;

-- Provider references are unique per provider, not globally.
ALTER TABLE transactions DROP CONSTRAINT transactions_payment_gateway_ref_key;
CREATE UNIQUE INDEX transactions_provider_ref_idx
  ON transactions (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE UNIQUE INDEX transactions_user_idempotency_idx
  ON transactions (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- "One purchase per user and book" moves to entitlements: a user may abandon
-- a checkout and start another, and only the paid one grants access.
DROP INDEX transactions_one_completed_per_book_idx;

CREATE INDEX transactions_status_idx ON transactions (status, created_at);


-- ---------------------------------------------------------------------------
-- Transaction items: immutable purchase snapshot
-- ---------------------------------------------------------------------------

CREATE TABLE transaction_items (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  book_id        UUID NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  -- Snapshotted: a title can change publisher, name or price later.
  publisher_id     UUID NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
  title            TEXT NOT NULL,
  unit_price_cents BIGINT NOT NULL,
  currency         CHAR(3) NOT NULL,

  -- Provider identifiers, used to map webhook line items and refunds back.
  provider_price_id     TEXT,
  provider_line_item_id TEXT,

  -- Set when payment is confirmed. gross = unit_price_cents (tax-inclusive).
  tax_cents          BIGINT,
  provider_fee_cents BIGINT,
  net_cents          BIGINT,

  refunded_cents BIGINT NOT NULL DEFAULT 0,
  -- Set when the item is fully refunded (or lost to a chargeback).
  refunded_at    TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT item_price_non_negative CHECK (unit_price_cents >= 0),
  CONSTRAINT item_refund_bounded CHECK (refunded_cents BETWEEN 0 AND unit_price_cents),
  CONSTRAINT item_one_book_per_transaction UNIQUE (transaction_id, book_id)
);

CREATE INDEX transaction_items_publisher_idx ON transaction_items (publisher_id, created_at);
CREATE INDEX transaction_items_book_idx ON transaction_items (book_id);
CREATE INDEX transaction_items_line_item_idx
  ON transaction_items (provider_line_item_id)
  WHERE provider_line_item_id IS NOT NULL;

-- Backfill one item per existing (single-book) transaction.
INSERT INTO transaction_items (transaction_id, book_id, publisher_id, title,
                               unit_price_cents, currency, created_at)
SELECT t.id, t.book_id, b.publisher_id, b.title, t.total_cents, t.currency, t.created_at
  FROM transactions t
  JOIN books b ON b.id = t.book_id;

UPDATE transactions SET paid_at = updated_at WHERE status = 'paid';

DROP INDEX transactions_book_idx;
ALTER TABLE transactions DROP COLUMN book_id;


-- ---------------------------------------------------------------------------
-- Adjustments: refunds and chargebacks, one row per provider adjustment
-- ---------------------------------------------------------------------------

CREATE TABLE transaction_adjustments (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  transaction_id         UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  provider               TEXT NOT NULL,
  -- Unique: the same refund can arrive in more than one webhook event.
  provider_adjustment_id TEXT NOT NULL,
  kind                   TEXT NOT NULL CHECK (kind IN ('refund', 'chargeback')),
  amount_cents           BIGINT NOT NULL CHECK (amount_cents >= 0),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT adjustment_provider_ref_unique UNIQUE (provider, provider_adjustment_id)
);

CREATE INDEX transaction_adjustments_transaction_idx ON transaction_adjustments (transaction_id);


-- ---------------------------------------------------------------------------
-- Payment events: every verified provider webhook, processed exactly once
-- ---------------------------------------------------------------------------

CREATE TABLE payment_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  transaction_id    UUID REFERENCES transactions(id) ON DELETE RESTRICT,
  occurred_at       TIMESTAMPTZ,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- applied: changed state. ignored: valid but no effect (stale, duplicate
  -- adjustment, unknown transaction). Detail says why.
  outcome           TEXT NOT NULL CHECK (outcome IN ('applied', 'ignored')),
  detail            TEXT,
  -- Digest rather than payload: provider payloads carry customer PII.
  payload_sha256    TEXT NOT NULL,

  CONSTRAINT payment_event_unique UNIQUE (provider, provider_event_id)
);

CREATE INDEX payment_events_transaction_idx ON payment_events (transaction_id);


-- ---------------------------------------------------------------------------
-- Entitlements: the server-side right to read a book
-- ---------------------------------------------------------------------------

CREATE TYPE entitlement_status AS ENUM ('active', 'revoked');

CREATE TABLE entitlements (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE RESTRICT,

  -- purchase: from a paid transaction item. grant: gift, promo, seed data.
  source          TEXT NOT NULL CHECK (source IN ('purchase', 'grant')),
  source_item_id  UUID REFERENCES transaction_items(id) ON DELETE RESTRICT,

  status            entitlement_status NOT NULL DEFAULT 'active',
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at        TIMESTAMPTZ,
  revocation_reason TEXT,

  CONSTRAINT purchase_has_item CHECK (source <> 'purchase' OR source_item_id IS NOT NULL),
  CONSTRAINT revocation_consistent CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);

-- History may hold revoked rows; at most one may be active.
CREATE UNIQUE INDEX entitlements_one_active_idx
  ON entitlements (user_id, book_id)
  WHERE status = 'active';

CREATE INDEX entitlements_source_item_idx ON entitlements (source_item_id);

-- Every existing library entry was access the user already had.
INSERT INTO entitlements (user_id, book_id, source, source_item_id, granted_at)
SELECT ul.user_id,
       ul.book_id,
       CASE WHEN ti.id IS NULL THEN 'grant' ELSE 'purchase' END,
       ti.id,
       ul.acquired_at
  FROM user_libraries ul
  LEFT JOIN transaction_items ti
    ON ti.transaction_id = ul.transaction_id AND ti.book_id = ul.book_id;


-- ---------------------------------------------------------------------------
-- Sales per book: the one definition of "a sale" for catalogue and portal
-- ---------------------------------------------------------------------------

-- Counts items in money-taken states that have not been fully refunded.
-- Revenue is gross (tax-inclusive) minus refunds.
CREATE VIEW book_sales AS
SELECT ti.book_id,
       COUNT(*)                                   AS sales_count,
       SUM(ti.unit_price_cents - ti.refunded_cents) AS gross_revenue_cents
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti.transaction_id
 WHERE t.status IN ('paid', 'partially_refunded', 'disputed')
   AND ti.refunded_at IS NULL
 GROUP BY ti.book_id;
