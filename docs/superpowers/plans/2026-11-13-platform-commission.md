# Platform Commission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Libraria takes a per-publisher, dated commission on each sale. The
commission is computed on what remains after VAT and the payment fee, is
snapshotted on every sold item, is reversed proportionally on refunds, and is
visible to publishers.

**Architecture:**
- A new table `publisher_commission_rates` holds the dated rates.
- Checkout snapshots each item's rate onto `transaction_items`.
- `applyPayment` computes both shares with one pure function, `splitEarnings`.
  `applyRefund` and `applyChargeback` recompute reversals from the cumulative
  refunded amount with `reverseShares`.
- A new admin router sets rates. Publishers read their rates through
  `/publisher/contract`, and the stats endpoints add earnings from the
  `book_sales` view.

**Tech Stack:** Node 24, Express 5, TypeScript, zod 4, pg, PostgreSQL 15,
node:test via tsx, Biome.

**Spec:** `docs/superpowers/specs/2026-11-13-platform-commission-design.md`

## Global Constraints

- **Base and formula (option B):**
  - `base = net_cents` (that is, price − VAT − provider fee);
  - `libraria = floor(base * rate_bps / 10000)`;
  - `publisher = base - libraria`.
- The formula lives only in `backend/src/commerce/commission.ts`. No SQL or
  route may recompute it.
- Rates are integer basis points from 0 to 10000 (2000 = 20%).
- Rounding favours the publisher, on sales and on refunds.
- A publisher with no rate in force cannot be sold. There is no 0% fallback,
  and existing publishers get no rate from the migration.
- Rate rows are never updated or deleted. There is no PATCH or DELETE endpoint.
- Error codes are UPPER_SNAKE and are added to `errorCodes` in
  `backend/src/middleware/errors.ts`. Errors use the body shape
  `{error:{code,message,requestId}}`.
- Migrations are forward-only. 0004 is new, and 0001–0003 are not edited.
- Do not commit or push unless the user has asked for it. Skip the "Commit"
  steps otherwise, and leave the changes in the working tree.
- Done means all of these pass: `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run test:integration` (with `docker compose up -d db`) and
  `npm run build`, all from `backend/`.

## Review Focus

1. **A cheap book where the fee exceeds price − VAT.** The base is ≤ 0, so
   Libraria takes 0 and the publisher's share equals the (negative) base. The
   shares still sum to the base. This is a unit test in Task 1.
2. **Several partial refunds, then a full one.** The cumulative reversals must
   equal the original shares exactly, with no cent drift. This is a unit test
   in Task 1 and an integration test in Task 3.
3. **A rate scheduled for the future** must not apply to today's checkouts. This
   is an integration test in Task 2.
4. **An admin setting a rate for an unknown publisher, or a duplicate
   `effectiveFrom`.** These return 404 and 409, never 500. This is in Task 4.
5. **A payment whose provider fee is unreported.** The shares stay null, and the
   stats count them as 0 instead of failing. This is in Task 3 (shares) and
   Task 5 (stats).

---

### Task 1: Commission math

**Files:**
- Create: `backend/src/commerce/commission.ts`
- Test: `backend/src/commerce/commission.test.ts`

**Interfaces:**
- Produces:
  - `export interface EarningsSplit { platformCommissionCents: number; publisherEarningsCents: number }`
  - `export function splitEarnings(netCents: number | null, rateBps: number): EarningsSplit | null`
  - `export interface ShareReversal { platformReversedCents: number; publisherReversedCents: number }`
  - `export function reverseShares(split: EarningsSplit, unitPriceCents: number, refundedCents: number): ShareReversal`
  - `export const MAX_RATE_BPS = 10000`

- [ ] **Step 1: Write failing tests** in `commission.test.ts` (`describe('splitEarnings')`, `describe('reverseShares')`):
  - `splitEarnings(1000, 2000)` → `{platformCommissionCents: 200, publisherEarningsCents: 800}`
  - `splitEarnings(733, 2000)` → `{146, 587}` (floor; publisher gets the remainder)
  - `splitEarnings(1000, 0)` → `{0, 1000}`; `splitEarnings(1000, 10000)` → `{1000, 0}`
  - `splitEarnings(1000, 1750)` → `{175, 825}`
  - `splitEarnings(null, 2000)` → `null`
  - `splitEarnings(-20, 2000)` → `{0, -20}`; `splitEarnings(0, 2000)` → `{0, 0}` (Review Focus 1)
  - `splitEarnings(1000, -1)` and `splitEarnings(1000, 10001)` and `splitEarnings(1000, 12.5)` throw `RangeError`
  - `reverseShares({200, 800}, 1000, 0)` → `{0, 0}`
  - `reverseShares({200, 800}, 1000, 1000)` → `{200, 800}`
  - `reverseShares({146, 587}, 1000, 333)` → `{49, 195}` (platform ceil(48.62)=49, publisher floor(195.47)=195)
  - Review Focus 2: for `split = {146, 587}`, price 1000, `reverseShares(split, 1000, r)` for r in `[100, 350, 999, 1000]` is non-decreasing in both fields, never exceeds the split, and at r=1000 equals the split exactly.
  - `reverseShares({0, 0}, 0, 0)` → `{0, 0}` (free item, no division by zero)
  - `reverseShares({0, -20}, 500, 500)` → `{0, -20}` (negative publisher share reverses to exactly the share)

- [ ] **Step 2: Run** `cd backend && npx tsx --test src/commerce/commission.test.ts`. Expected: FAIL, because the module is not found.

- [ ] **Step 3: Implement `splitEarnings` and `reverseShares`.**
  - **`splitEarnings`:** validate that the rate is an integer from 0 to `MAX_RATE_BPS`, otherwise throw `RangeError`. If `base <= 0`, Libraria gets 0. Otherwise use `Math.floor(base * rateBps / 10000)`.
  - **`reverseShares`:** if `refundedCents >= unitPriceCents`, return the full split. Otherwise:
    - `platformReversedCents = Math.ceil(platform * refunded / price)`, capped at `platform`;
    - `publisherReversedCents = Math.floor(publisher * refunded / price)`.
  - Add a doc comment explaining that both functions are the only place the option B base and the rounding policy are defined.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(commerce): commission split and refund reversal math`.

---

### Task 2: Schema, fixtures and the checkout rate snapshot

**Files:**
- Create: `backend/db/migrations/0004_platform_commission.sql`
- Modify:
  - `backend/src/commerce/service.ts`, in `createCheckout`: the book query and the item insert;
  - `backend/src/middleware/errors.ts`: the `errorCodes` list;
  - `backend/test/integration/harness.ts`: `createPublisher`;
  - `backend/src/db/seed.ts`: after the publisher insert.
- Test: `backend/test/integration/commission.test.ts` (new)

**Interfaces:**
- Produces:
  - **Table `publisher_commission_rates`:**
    - `id UUID PK DEFAULT gen_random_uuid()`;
    - `publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT`;
    - `rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000)`;
    - `effective_from TIMESTAMPTZ NOT NULL`;
    - `contract_reference TEXT CHECK (char_length(contract_reference) <= 200)`;
    - `created_by UUID REFERENCES users(id) ON DELETE SET NULL`;
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`;
    - `UNIQUE (publisher_id, effective_from)`.
  - **New columns on `transaction_items`** (all nullable, no backfill):
    - `commission_rate_bps INTEGER`;
    - `platform_commission_cents BIGINT`;
    - `publisher_earnings_cents BIGINT`;
    - `platform_commission_reversed_cents BIGINT NOT NULL DEFAULT 0`;
    - `publisher_earnings_reversed_cents BIGINT NOT NULL DEFAULT 0`.
  - **`CREATE OR REPLACE VIEW book_sales`** keeps the existing three columns, in order, and appends:
    - `publisher_earnings_cents = SUM(COALESCE(ti.publisher_earnings_cents,0) - ti.publisher_earnings_reversed_cents)`;
    - `platform_commission_cents = SUM(COALESCE(ti.platform_commission_cents,0) - ti.platform_commission_reversed_cents)`.
    The `WHERE` clause is unchanged.
  - **Error code:** `BOOK_NOT_FOR_SALE` (409).
  - **Harness:** `createPublisher(name?: string, options?: { commissionBps?: number | null; effectiveFrom?: string }): Promise<string>`. The defaults are `commissionBps` 2000 and `effectiveFrom` `'2020-01-01T00:00:00Z'`; `null` means no rate row. Existing call sites stay unchanged.

- [ ] **Step 1: Write failing integration tests** in `commission.test.ts`, using the same `before`/`beforeEach`/`after` setup as `commerce.test.ts`.
  - `describe('commission rate at checkout')`:
    - `'snapshots the publisher rate in force on each item'`: one publisher at 2000 and one at 1500, one book each, then `checkout`. `transaction_items.commission_rate_bps` is `2000` and `1500` respectively.
    - `'refuses checkout when a publisher has no rate'`: `createPublisher(undefined, { commissionBps: null })`, then checkout returns 409 `BOOK_NOT_FOR_SALE`, and `SELECT COUNT(*) FROM transactions` is 0.
    - `'refuses the whole cart if any publisher lacks a rate'`: two books, one with a rate and one without. The result is 409, and no transaction is created.
    - `'ignores a rate scheduled for the future'` (Review Focus 3): first insert a rate at 2000 from 2020. Then insert one at 500 with `effective_from = now() + interval '1 day'`. After checkout, `commission_rate_bps` is 2000.

- [ ] **Step 2: Run** `docker compose up -d db`, then `cd backend && npx tsx --test --test-concurrency=1 test/integration/commission.test.ts`. Expected: FAIL. The relation `publisher_commission_rates` does not exist, or the column does not exist.

- [ ] **Step 3: Write `0004_platform_commission.sql`** with the schema above. Add a comment on the table: rows are never edited, and corrections are new rows. The `UNIQUE (publisher_id, effective_from)` index serves the rate lookup, so no extra index is needed.

- [ ] **Step 4: Update `createCheckout`.**
  - The book query gets `LEFT JOIN LATERAL (SELECT rate_bps FROM publisher_commission_rates r WHERE r.publisher_id = b.publisher_id AND r.effective_from <= CURRENT_TIMESTAMP ORDER BY r.effective_from DESC LIMIT 1) rate ON TRUE` and selects `rate.rate_bps AS commission_rate_bps` (`number | null`).
  - After the 404 check and before the currency check, throw `new AppError(409, 'One or more books are not for sale right now', 'BOOK_NOT_FOR_SALE')` if any book's rate is null.
  - The item insert unnests a second array, `$3::int[]`, of rates aligned with the ids, and writes `commission_rate_bps`.

- [ ] **Step 5: Update the harness and the seed.**
  - `createPublisher` inserts the rate row unless `commissionBps === null`.
  - `seed.ts` inserts a 2000 rate for the Apex publisher from `'2020-01-01'`, using `ON CONFLICT (publisher_id, effective_from) DO NOTHING`.
  - Add `'BOOK_NOT_FOR_SALE'` to `errorCodes` in the commerce group.

- [ ] **Step 6: Run** the commission tests and then the full `npm run test:integration`. Expected: PASS, and the existing commerce, publisher-isolation and library tests are unaffected.

- [ ] **Step 7: Commit**, but only if authorised: `feat(commerce): per-publisher commission rates snapshotted at checkout`.

---

### Task 3: Shares on payment, reversals on refund and chargeback

**Files:**
- Modify: `backend/src/commerce/service.ts`: `ItemRow`, the item `SELECT` in `applyEvent`, `applyPayment`, `applyRefund` and `applyChargeback`.
- Test: `backend/test/integration/commission.test.ts`

**Interfaces:**
- Consumes: `splitEarnings` and `reverseShares` (Task 1), and the columns from Task 2.
- Produces: the private helper `applyReversal(client, item: ItemRow): Promise<void>` in `service.ts`. It writes both `*_reversed_cents` columns from `reverseShares` using the item's cumulative `refunded_cents`. If the shares are null, it is a no-op.

- [ ] **Step 1: Write failing tests** in `describe('commission on sales')`. To control the totals, send a signed webhook with `paymentFor(cents)`, the same way the `commerce.test.ts` webhook tests sign and post with `env.SIMULATED_WEBHOOK_SECRET`. Copy the `webhook`/`postWebhook`/`paymentFor` helpers into the file.
  - `'splits net between Libraria and the publisher at the snapshotted rate'`: a €10 book (1000) at 2000, and `paymentFor(1000)`, where tax and fee are 0. The item has `platform_commission_cents` 200 and `publisher_earnings_cents` 800.
  - `'accounts for every cent'`: `buy` two books from publishers at 2000 and 1500 through the default sandbox totals (with VAT and fees). For each item, `tax + provider_fee + platform_commission + publisher_earnings == unit_price`.
  - `'keeps past sales at their old rate after a contract change'`:
    - buy book A at 2000;
    - insert a new rate of 1000 effective now;
    - buy book B;
    - item A still has 2000 and 200/800, and item B has 1000.
  - `'leaves shares null when the provider fee is unreported'` (Review Focus 5): `paymentFor(1000)` with `totals.feeCents: null, earningsCents: null`. Both share columns are null, and the transaction is `paid`.
  - `'reverses both shares on a full refund'`: use `buy`, then the sandbox `{kind:'refund'}` for the whole order (as in the existing full-refund test). The reversed columns equal the shares.
  - `'reverses shares proportionally across several partial refunds without drift'` (Review Focus 2): a €10 book at 2000, settled with `paymentFor(1000)`, so the shares are 200/800. Send sandbox partial refunds (`partialAmountCents`) of 300 and then 300. The reversals are computed from the cumulative 600: 120/480. A final full refund gives exactly 200/800.
  - `'reverses everything on a lost chargeback'`: buy, then a sandbox chargeback. The reversals equal the shares.

- [ ] **Step 2: Run** the commission integration file. Expected: FAIL, because the share columns are null.

- [ ] **Step 3: Implement the changes in `service.ts`.**
  - **Item rows:** `ItemRow` gains `commission_rate_bps: number | null`, `platform_commission_cents: string | null` and `publisher_earnings_cents: string | null`, and the `SELECT` gains the same columns.
  - **`applyPayment`:** in the per-item update, compute `splitEarnings(net, item.commission_rate_bps)`, where `net` is the value already written to `net_cents`. If the rate is null (a legacy row), the split is null. Write both columns in the same `UPDATE`.
  - **`applyRefund`:** after each item's `refunded_cents` update, call `applyReversal`. Update the in-memory row first, so the reversal uses the new cumulative amount.
  - **`applyChargeback`:** after the bulk `refunded_cents = unit_price_cents` update, set each in-memory item's `refunded_cents` to its price and call `applyReversal` for every item.

- [ ] **Step 4: Run** the commission file, then `npm run test:integration`. Expected: all PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(commerce): record and reverse commission shares`.

---

### Task 4: Admin rates API and the publisher contract endpoint

**Files:**
- Create: `backend/src/routes/admin.ts`
- Modify:
  - `backend/src/app.ts`: add `v1.use('/admin', adminRouter)`;
  - `backend/src/routes/publisher.ts`: new route;
  - `backend/src/middleware/errors.ts`: add a code.
- Create: `backend/src/commerce/rates.ts`, for the shared queries.
- Test:
  - `backend/test/integration/commission.test.ts`;
  - `backend/src/routes/admin.test.ts`, for the schema unit tests.

**Interfaces:**
- **Produces (`rates.ts`):**
  - `export interface CommissionRate { id: string; rateBps: number; effectiveFrom: string; contractReference: string | null; inForce: boolean }`
  - `export async function listRates(publisherId: string): Promise<CommissionRate[]>`. The list is ordered newest `effectiveFrom` first. `inForce` is true on exactly the latest row whose start is not in the future.
- **Produces (`admin.ts`):**
  - `export const adminRouter`, using `requireAuth, requireRole('admin')`.
  - `export const createRateSchema = z.object({ rateBps: z.number().int().min(0).max(10000), effectiveFrom: z.iso.datetime({ offset: true }).optional(), contractReference: z.string().trim().min(1).max(200).optional() })`. Check how the project's zod 4 version spells ISO datetime before using it.
  - **`POST /publishers/:id/commission-rates`:**
    - `effectiveFrom` defaults to the current time, and `created_by` is the admin user;
    - the response is `201 { rate: CommissionRate }`;
    - an FK violation (`PG_FOREIGN_KEY_VIOLATION`) returns `404 NOT_FOUND`;
    - a unique violation returns `409 COMMISSION_RATE_EXISTS`.
  - **`GET /publishers/:id/commission-rates`:** `200 { publisherId, rates: CommissionRate[] }`. An unknown publisher returns 404.
- **Produces (`publisher.ts`):** `GET /contract` returns `200 { publisherId, current: CommissionRate | null, history: CommissionRate[] }`. It is scoped with `resolvePublisherScope(req, publisherScopeQuerySchema.parse(req.query).publisherId)`, so a publisher's `publisherId` query is ignored. `created_by` is never exposed.
- **Error code:** `COMMISSION_RATE_EXISTS`.

- [ ] **Step 1: Write failing tests.**
  - Unit tests in `admin.test.ts`: `createRateSchema` accepts `{rateBps: 1750}`, and rejects 10001, -1, 12.5, a 201-character reference and a non-ISO date.
  - Integration tests in `describe('commission rates API')`:
    - `'lets an admin add a dated rate and list the history'`: two POSTs (2000 from 2020, which comes from the fixture, then 1500 from now). The GET returns both, newest first, and only the 1500 row is `inForce`.
    - `'refuses non-admins'`: a POST as a publisher user or as a reader returns 403 `FORBIDDEN`. Without a token it returns 401.
    - `'returns 404 for an unknown publisher and 409 for a duplicate start date'` (Review Focus 4).
    - `'shows a publisher only their own contract'`:
      - staff of A calling `GET /publisher/contract?publisherId=<B>` gets A's `publisherId` and rates;
      - `current.rateBps` is 2000;
      - the body contains no `createdBy`.
    - `'returns current: null for a publisher without a rate'`.

- [ ] **Step 2: Run** `npx tsx --test src/routes/admin.test.ts` and the commission integration file. Expected: FAIL.

- [ ] **Step 3: Implement `rates.ts`, `admin.ts` and the `/contract` route, and mount `adminRouter`.** Add `'COMMISSION_RATE_EXISTS'` to `errorCodes`.

- [ ] **Step 4: Run** both test commands and then `npm run test:integration`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(api): admin commission rates and publisher contract endpoint`.

---

### Task 5: Earnings in publisher stats, then docs and full verification

**Files:**
- Modify:
  - `backend/src/routes/publisher.ts`: `/stats`, `PublisherBookRow`, `formatPublisherBook`, and the three `book_sales` joins;
  - `README.md`: the Payments section.
- Test: `backend/test/integration/commission.test.ts`

**Interfaces:**
- Consumes: the extra `book_sales` view columns from Task 2.
- Produces:
  - `/publisher/stats`: `stats` gains `totalEarningsCents` and `totalPlatformCommissionCents`.
  - Book `metrics` gain `earningsCents`, the publisher's share after reversals.

- [ ] **Step 1: Write a failing test**, `'reports publisher earnings and Libraria commission in stats'`:
  - buy a €10 book at 2000 with `paymentFor(1000)`, so shares are 200/800;
  - buy a second €10 book and refund it fully;
  - buy a third with a null fee (Review Focus 5).
  - `GET /publisher/stats` gives `totalEarningsCents` 800 and `totalPlatformCommissionCents` 200, with no error from the null-fee sale.
  - `GET /publisher/books` gives the first book `metrics.earningsCents` 800.

- [ ] **Step 2: Run** it. Expected: FAIL, because the fields are undefined.

- [ ] **Step 3: Implement.**
  - Select `publisher_earnings_cents` and `platform_commission_cents` from `book_sales` in the joins.
  - Sum them with `COALESCE(...)::bigint` in `/stats`.
  - Map the values in `formatPublisherBook`, using `Number(... ?? 0)`.

- [ ] **Step 4: Update the README Payments section.** Under "Policies currently implemented", replace the "commission is not yet decided" bullet with the option B formula and these points:
  - rates are per publisher and dated;
  - rates are snapshotted at checkout;
  - a publisher without a rate cannot sell;
  - refunds reverse shares proportionally, in the publisher's favour;
  - admins set rates with `POST /api/v1/admin/publishers/:id/commission-rates`;
  - the formula lives in `backend/src/commerce/commission.ts`.

- [ ] **Step 5: Full verification** from `backend/`:
  - `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` and `npm run build`;
  - in `mobile/`, `npx tsc --noEmit`, to confirm nothing changed there.

  Expected: every command exits 0. Report the unit and integration test counts.

- [ ] **Step 6: Commit**, but only if authorised: `feat(publisher): earnings and commission in portal stats`.
