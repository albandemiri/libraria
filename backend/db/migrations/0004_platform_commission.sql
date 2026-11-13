-- Platform commission: Libraria takes a per-publisher, contract-dated
-- percentage of what is left of each sale after VAT and the payment fee.
-- The formula lives in backend/src/commerce/commission.ts; this migration
-- only stores rates and the per-item results.

-- ---------------------------------------------------------------------------
-- Contract rates
-- ---------------------------------------------------------------------------

-- Rows are never edited or deleted: a new contract, or a correction, is a new
-- row. The rate in force at time T is the row with the latest
-- effective_from <= T. No row in force means the publisher cannot sell.
CREATE TABLE publisher_commission_rates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publisher_id       UUID NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
  rate_bps           INTEGER NOT NULL,
  effective_from     TIMESTAMPTZ NOT NULL,
  contract_reference TEXT,
  created_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT commission_rate_range CHECK (rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT commission_contract_reference_length
    CHECK (contract_reference IS NULL OR char_length(contract_reference) <= 200),
  -- Also serves the "rate in force" lookup.
  CONSTRAINT commission_rate_unique_start UNIQUE (publisher_id, effective_from)
);

-- ---------------------------------------------------------------------------
-- Per-item commission snapshot
-- ---------------------------------------------------------------------------

-- commission_rate_bps is captured at checkout; the shares once payment is
-- confirmed and the provider fee is known (null until then, and for sales
-- made before this migration). Reversals grow with refunds.
ALTER TABLE transaction_items
  ADD COLUMN commission_rate_bps                INTEGER,
  ADD COLUMN platform_commission_cents          BIGINT,
  ADD COLUMN publisher_earnings_cents           BIGINT,
  ADD COLUMN platform_commission_reversed_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN publisher_earnings_reversed_cents  BIGINT NOT NULL DEFAULT 0,
  ADD CONSTRAINT item_commission_rate_range
    CHECK (commission_rate_bps IS NULL OR commission_rate_bps BETWEEN 0 AND 10000);

-- ---------------------------------------------------------------------------
-- Sales per book, now with earnings
-- ---------------------------------------------------------------------------

-- Same rows as before; appends each side's share net of refund reversals.
-- Shares not yet known count as 0.
CREATE OR REPLACE VIEW book_sales AS
SELECT ti.book_id,
       COUNT(*)                                     AS sales_count,
       SUM(ti.unit_price_cents - ti.refunded_cents) AS gross_revenue_cents,
       SUM(COALESCE(ti.publisher_earnings_cents, 0) - ti.publisher_earnings_reversed_cents)
                                                    AS publisher_earnings_cents,
       SUM(COALESCE(ti.platform_commission_cents, 0) - ti.platform_commission_reversed_cents)
                                                    AS platform_commission_cents
  FROM transaction_items ti
  JOIN transactions t ON t.id = ti.transaction_id
 WHERE t.status IN ('paid', 'partially_refunded', 'disputed')
   AND ti.refunded_at IS NULL
 GROUP BY ti.book_id;
