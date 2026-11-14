# Publisher Portal (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bilingual (Albanian/English) publisher web portal with a
transparent sales and money dashboard and book management. It is backed by
new reporting endpoints, buyer-country capture and a secure cookie login.

**Architecture:**
- **Backend:** a single reporting module, `backend/src/reports/`, defines what
  a sale is and how each metric is calculated. The summary, by-book,
  by-country, ledger and CSV endpoints all build on it, so their totals always
  agree.
- **Login:** a portal-only cookie login sits beside the existing Bearer login.
  The mobile app is unchanged.
- **Portal:** a new Vite/React SPA in `portal/` that only displays numbers the
  backend computed.

**Tech Stack:**
- **Backend:** Node 24, Express 5, TypeScript, zod 4, pg, PostgreSQL 15,
  node:test with tsx, and Biome.
- **Portal:** Vite, React 19, TypeScript (strict), React Router,
  @tanstack/react-query, Recharts, i18next with react-i18next, Vitest,
  @testing-library/react with jsdom, and Biome.

**Spec:** `docs/superpowers/specs/2026-11-13-publisher-portal-design.md`

## Global Constraints

- **Migrations:**
  - forward-only;
  - new file `0005_customer_country.sql`;
  - 0001–0004 are never edited.
- **Errors:**
  - codes are UPPER_SNAKE and listed in `errorCodes` in
    `backend/src/middleware/errors.ts`;
  - the response body shape is `{error:{code,message,requestId}}`.
- **Tenant scope:**
  - publisher accounts are always scoped to their own house;
  - a publisher's `publisherId` parameter is ignored;
  - admins must pass `publisherId` on reports.
  - Use the existing `resolvePublisherScope` in `backend/src/routes/publisher.ts`.
- **Reporting rules:**
  - A sale is an item whose transaction is in `paid`, `partially_refunded`,
    `disputed` or `refunded`.
  - The period is `transactions.paid_at`, in **UTC**. `from` is inclusive and
    `to` is exclusive. Weeks start on Monday (Postgres `date_trunc('week')`).
  - Refunds count in the sale's own period.
  - Null fees and shares count as 0.
- **Line status** is the item's own status, never the order's:
  - `refunded` if `refunded_at` is set;
  - otherwise `partially_refunded` if `refunded_cents > 0`;
  - otherwise `disputed` if the transaction is disputed;
  - otherwise `paid`.
- **Money in the browser:** the portal never computes money. It may only
  format the numbers, and compute percentage change between two
  backend-supplied totals.
- **Language:**
  - every user-visible string in the portal comes from
    `portal/src/i18n/{en,sq}.json`;
  - both files have identical keys;
  - formatting uses the `Intl` locales `sq-AL` and `en-IE`.
- **Portal login cookie:**
  - the name is `libraria_portal`, `HttpOnly`, `SameSite=Lax`, `Path=/api`;
  - `Secure` when `NODE_ENV=production`;
  - lifetime 30 days with "Remember me" (`PORTAL_REMEMBER_DAYS`), otherwise a
    session cookie holding a 12-hour token (`PORTAL_SESSION_HOURS`).
- **Forged-request check:** a request authenticated by the cookie that is not
  GET, HEAD or OPTIONS must send `X-Libraria-Portal: 1`, otherwise it gets
  `403 CSRF_CHECK_FAILED`.
- **Dependencies:** for the portal, install the current versions with npm, and
  check each library's API against its installed types and docs, not memory.
  The backend gains no new runtime dependencies: the cookie and CORS handling
  are small hand-written middleware.
- **Docker:** do not add the portal to docker compose, and keep Docker checks
  quick.
- **Commits:** do not commit or push unless the user asks. Skip the "Commit"
  steps otherwise.
- **Done means** all of these pass:
  - in `backend/`: `npm run lint`, `npm run typecheck`, `npm test`,
    `npm run test:integration` (with `docker compose up -d db`) and
    `npm run build`;
  - in `portal/`: `npm run lint`, `npm run typecheck`, `npm test` and
    `npm run build`;
  - in `mobile/`: `npm run typecheck`.

## Review Focus

1. **Totals that disagree across pages for the same filters.** Summary totals
   must equal the sum of the `/sales` lines, which must equal the sum of the
   by-book and by-country rows, including after full and partial refunds and
   with items whose split is pending. This is tested in Task 3.
2. **Another publisher's data leaking out.** This could come through a
   multi-publisher order (a line's status or refunds), the CSV export, an
   admin's stale picker on book writes, or a publisher passing `publisherId`.
   This is tested in Tasks 2, 3 and 4.
3. **Sales at period edges.** A sale paid at 23:30 UTC on the last day of a
   month belongs to that month, and periods with no sales are returned with
   zeros. This is tested in Task 2.
4. **A cookie session used without the portal header** on a write request,
   from another origin, or after logout. These must fail. Mobile Bearer
   requests must keep working. This is tested in Task 5.
5. **Book titles in CSV** containing commas, quotes, newlines or a leading
   `=`, `+`, `-` or `@`. These must be quoted, and the formula characters
   neutralised so spreadsheets don't execute them. This is tested in Task 3.

---

### Task 1: Buyer country on every sale

**Files:**
- Create: `backend/db/migrations/0005_customer_country.sql`
- Modify:
  - `backend/src/commerce/providers/types.ts`: the `payment_succeeded` member
    and `PaymentProvider`;
  - `backend/src/commerce/providers/simulated.ts`: the event schema;
  - `backend/src/routes/sandbox.ts`: the schema and the `payment_succeeded`
    case;
  - `backend/src/commerce/providers/paddle.ts`: `completedDataSchema`, the
    `transaction.completed` mapping, and a new `lookupCountry`;
  - `backend/src/commerce/service.ts`: `processWebhook` and `applyPayment`.
- Test:
  - `backend/src/commerce/providers/paddle.test.ts`;
  - `backend/test/integration/reports.test.ts` (new).

**Interfaces:**
- Produces:
  - **Column:** `transactions.customer_country CHAR(2)`, nullable, with
    `CHECK (customer_country ~ '^[A-Z]{2}$')`.
  - **Event field:** the `payment_succeeded` event gains
    `countryCode: string | null`.
  - **Provider method:** `PaymentProvider` gains the optional
    `lookupCountry?(providerTransactionId: string): Promise<string | null>`.
  - **Normalising helper:** `normalizeCountry(value: unknown): string | null`
    in `backend/src/commerce/country.ts`. It trims, upper-cases, and returns
    null unless the result matches `/^[A-Z]{2}$/`.
  - **Sandbox:** the sandbox body gains `countryCode?: string | null`, with a
    default of `'DE'`. An explicit `null` means unknown.

- [ ] **Step 1: Write failing tests.**
  - **`country.test.ts`:**
    - `normalizeCountry(' de ')` → `'DE'`;
    - `'DEU'`, `''`, `null`, `42` and `'D1'` each → `null`.
  - **`paddle.test.ts`:**
    - a `transaction.completed` payload with `address: { country_code: 'AL' }`
      maps to `countryCode: 'AL'`;
    - without an address, it maps to `null`;
    - `lookupCountry('txn_1')` calls
      `GET {base}/transactions/txn_1?include=address` with the Bearer API key
      and returns `'XK'` from `data.address.country_code`;
    - on HTTP 500 or a network error it returns `null`, never throws.
  - **`reports.test.ts`:** set up the same way as `commission.test.ts`, then:
    - a sandbox `payment_succeeded` with no `countryCode` stores `'DE'`;
    - with `countryCode: 'al'` it stores `'AL'`;
    - with `countryCode: null` it stores `NULL`;
    - the transaction is still `paid` in every case.

- [ ] **Step 2: Run** `cd backend && npx tsx --test src/commerce/country.test.ts src/commerce/providers/paddle.test.ts`, then `npx tsx --test --test-concurrency=1 test/integration/reports.test.ts`. Expected: FAIL. The module is not found, and the column does not exist.

- [ ] **Step 3: Implement.**
  - **Migration:** write `0005_customer_country.sql`.
  - **Paddle mapping:** read `data.address?.country_code`, marked
    `// VERIFY`, as an optional schema field.
  - **`lookupCountry`:** add it to `PaddleProvider`, reusing `fetchImpl` and
    the API base. It catches all errors and returns null.
  - **`processWebhook`:** after `parseWebhook` and **before**
    `withTransaction`, if the event is `payment_succeeded` with
    `countryCode === null`, a `providerTransactionId`, and the provider has
    `lookupCountry`, await the lookup and set the country on the event.
  - **`applyPayment`:** write `customer_country = normalizeCountry(event.countryCode)`
    in the existing `UPDATE transactions`.
  - **Sandbox:** build the event with `countryCode: input.countryCode === undefined ? 'DE' : input.countryCode`.

- [ ] **Step 4: Run** the same commands, then the full `npm run test:integration`. Expected: all PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(commerce): record the buyer's country on each sale`.

---

### Task 2: Reporting rules, summary, by-book and by-country

**Files:**
- Create:
  - `backend/src/reports/base.ts`, the single definition of the rules;
  - `backend/src/reports/metrics.ts`, the row-to-`Metrics` mapping;
  - `backend/src/routes/reports.ts`.
- Modify: `backend/src/routes/publisher.ts`. Export `resolvePublisherScope`
  and `publisherScopeQuerySchema`, and mount
  `publisherRouter.use('/reports', reportsRouter)` before the `/books` routes.
- Test:
  - `backend/test/integration/reports.test.ts`;
  - `backend/src/routes/reports.test.ts`, for schema unit tests.

**Interfaces:**
- **Produces (`metrics.ts`):**
  ```ts
  export interface Metrics {
    grossCents: number; refundsCents: number; taxCents: number; feeCents: number;
    netCents: number;              // gross - tax - fee (nulls as 0)
    commissionAtSaleCents: number; commissionReversedCents: number; commissionCents: number;
    unsplitCents: number;          // net of items whose split is not done
    earningsAtSaleCents: number; earningsReversedCents: number; earningsCents: number;
    copies: number; refundedCopies: number;
  }
  export const ZERO_METRICS: Metrics;
  export function toMetrics(row: Record<string, string | number | null>): Metrics;
  ```
  Invariant: `netCents = commissionAtSaleCents + unsplitCents + earningsAtSaleCents`.
  This is what lets the Earnings table add up when a sale's split is pending.
- **Produces (`base.ts`):**
  - `export interface ReportFilters { publisherId: string; from: string; to: string; bookId?: string; country?: string | null; status?: ItemStatus }`
  - `export type ItemStatus = 'paid' | 'partially_refunded' | 'refunded' | 'disputed'`
  - `export function salesBase(filters: ReportFilters): { sql: string; params: unknown[] }`
    It returns a `SELECT` with exactly one row per sale and these columns:
    - item and transaction ids, `paid_at`, `book_id`, `title`,
      `customer_country`;
    - `item_status` (from the Global Constraints rule);
    - `split`: `'no_rate'` when `commission_rate_bps IS NULL`, else
      `'pending'` when `platform_commission_cents IS NULL`, else `'done'`;
    - the money columns, with nulls as 0.

    Every report wraps this as a CTE.
  - `export const METRICS_SQL: string`, the aggregate expressions that produce
    each `Metrics` field from the base CTE `s`.
- **Produces (`reports.ts`):**
  - `export const rangeQuerySchema`: `from` and `to` as `YYYY-MM-DD`;
    `to > from`; at most 3 years apart; optional `publisherId` (uuid).
  - `GET /summary?from&to&granularity=day|week|month` → `{ totals: Metrics, series: Array<{ periodStart: string } & Metrics> }`.
    Every period in the range is present, with zeros where empty, using
    `generate_series` in UTC.
  - `GET /by-book?from&to` → `{ rows: Array<{ book: {id,title} } & Metrics> }`,
    sorted by `grossCents` descending.
  - `GET /by-country?from&to` → `{ rows: Array<{ country: string | null } & Metrics> }`,
    sorted by `grossCents` descending.

- [ ] **Step 1: Write failing tests.**
  - **Unit:** `rangeQuerySchema` rejects `to <= from`, a span over 3 years,
    and non-ISO dates, and accepts `2026-11-01..2026-12-01`.
  - **Integration,** using the `sellAtNet`/`settle` helpers (copied from
    `commission.test.ts`, extended with an optional `paidAt` and
    `countryCode`), then `UPDATE transactions SET paid_at = …` for fixed
    dates:
    - `'summary totals and series for a month'`: two €10 sales on 3 Nov and
      one on 20 Nov, at 20%, with fee 0. `totals.grossCents` is 3000,
      `earningsCents` is 2400 and `copies` is 3. A `granularity=month` series
      over Oct–Dec has 3 entries, with zeros for Oct and Dec.
    - `'UTC month edge'`: a sale with `paid_at = '2026-11-30T23:30:00Z'`
      counts in November and not December.
    - `'earnings breakdown adds up after refunds and pending splits'`:
      - one sale fully refunded, one refunded 300 of 1000, and one with
        `fee=null`;
      - for the totals, assert
        `grossCents - taxCents - feeCents === netCents`;
      - and `netCents === commissionAtSaleCents + unsplitCents + earningsAtSaleCents`;
      - and `earningsCents === earningsAtSaleCents - earningsReversedCents`;
      - `refundedCopies` is 1.
    - `'by-book and by-country rows sum to the totals'`: two books and three
      countries (`'AL'`, `'XK'`, `null`). For each `Metrics` key, the sum over
      rows equals `totals`.
    - `'never shows another publisher's sales'`:
      - publisher A's staff passing `publisherId=B` get A's numbers;
      - an admin without `publisherId` gets `400 PUBLISHER_ID_REQUIRED`;
      - a reader gets 403.

- [ ] **Step 2: Run** `npx tsx --test src/routes/reports.test.ts` and the integration file. Expected: FAIL (404 route or module not found).

- [ ] **Step 3: Implement** `metrics.ts`, `base.ts` and the three routes in `reports.ts`. Use `resolvePublisherScope`.

- [ ] **Step 4: Run** the tests, then the full `npm run test:integration`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(reports): sales reporting rules with summary, book and country breakdowns`.

---

### Task 3: Sales ledger and CSV export

**Files:**
- Create: `backend/src/reports/csv.ts`
- Modify: `backend/src/routes/reports.ts`
- Test:
  - `backend/src/reports/csv.test.ts`;
  - `backend/test/integration/reports.test.ts`.

**Interfaces:**
- **Consumes:** `salesBase`, `ReportFilters` and `ItemStatus` (Task 2).
- **Produces:**
  - `GET /sales?from&to&bookId?&country?&status?&page=1&limit=50` (limit at
    most 200), sorted by `paid_at DESC`, then item id. It returns
    `{ lines: SalesLine[], pagination: {page,limit,total,totalPages} }`:
    ```ts
    interface SalesLine { paidAt: string; transactionId: string; book: {id,title};
      country: string | null; status: ItemStatus; unitPriceCents: number; taxCents: number;
      feeCents: number | null; commissionRateBps: number | null; commissionCents: number;
      earningsCents: number; refundedCents: number; split: 'done' | 'pending' | 'no_rate' }
    ```
    `country=unknown` filters on null countries.
  - `GET /sales.csv?…same filters…&lang=en|sq`:
    - `Content-Type: text/csv; charset=utf-8`;
    - `Content-Disposition: attachment; filename="libraria-sales-<from>-<to>.csv"`;
    - a UTF-8 BOM, a header row in `lang`, and at most 50,000 data rows;
    - if more rows would match, it returns `422` with the code
      `EXPORT_TOO_LARGE` (a new code), asking the user to narrow the range.
  - In `csv.ts`:
    - `export function csvField(value: string | number | null): string`
      quotes as RFC 4180 requires. A string starting with `=`, `+`, `-`, `@`,
      tab or CR is prefixed with `'`.
    - `export const CSV_HEADERS: Record<'en' | 'sq', string[]>`
    - `export function toCsvRow(line: SalesLine): string`
  - **Column order:**
    - `paid_at`, `transaction_id`, `book_id`, `title`, `country`, `status`;
    - `unit_price`, `vat`, `fee`, `commission_rate_percent`, `commission`,
      `earnings`, `refunded`, `split`.
  - **Values:**
    - amounts as euros with 2 decimals and `.` as the separator, computed from
      cents with integer arithmetic (no floats);
    - `commission_rate_percent` as `bps/100` with 2 decimals;
    - ISO UTC dates;
    - the raw status and split codes.
  - **Albanian headers:** "Data e pagesës", "ID e transaksionit",
    "ID e librit", "Titulli", "Shteti", "Statusi", "Çmimi", "TVSH", "Tarifa",
    "Komisioni (%)", "Komisioni", "Fitimi", "Rimbursuar", "Ndarja".
  - **English headers:** "Paid at", "Transaction ID", "Book ID", "Title",
    "Country", "Status", "Unit price", "VAT", "Fee", "Commission (%)",
    "Commission", "Earnings", "Refunded", "Split".

- [ ] **Step 1: Write failing tests.**
  - **Unit:**
    - `csvField('Tom, "Jerry"')` → `"Tom, ""Jerry"""`;
    - `csvField('=SUM(A1)')` → `"'=SUM(A1)"`;
    - `csvField('line\nbreak')` is quoted;
    - `csvField(null)` → `''`;
    - `toCsvRow` formats 1999 cents as `19.99` and 5 cents as `0.05`;
    - both `CSV_HEADERS` lists have 14 entries.
  - **Integration:**
    - `'sales lines sum to the summary totals'`: for the same filters,
      `Σ unitPriceCents`, `Σ earningsCents` and `Σ commissionCents` equal the
      summary `grossCents`, `earningsCents` and `commissionCents`.
    - `'a line shows its own book status in a multi-publisher order'`:
      publishers A and B share one order, then B's book is refunded through
      the sandbox with `bookIds` (use `buy()`, so line items map). A's line
      status is `paid` and A's summary has `refundsCents` of 0.
    - `'pending split is labelled'`: a sale with `fee=null` has
      `split: 'pending'`.
    - `'filters by status and unknown country'`.
    - `'CSV export in Albanian'`:
      - the headers start with the BOM and `Data e pagesës`;
      - one row has a title containing a comma and a quote, correctly quoted;
      - the amounts are `9.99`.
    - `'CSV export is tenant scoped'`: publisher A's export contains no rows
      for B.

- [ ] **Step 2: Run** the unit and integration tests. Expected: FAIL.

- [ ] **Step 3: Implement** `csv.ts`, `/sales` and `/sales.csv`, and add `EXPORT_TOO_LARGE` to `errorCodes`.

- [ ] **Step 4: Run** the tests, then the full integration suite. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(reports): sales ledger and bilingual CSV export`.

---

### Task 4: Admin publisher list, and checking the picked publisher on book writes

**Files:**
- Modify:
  - `backend/src/routes/admin.ts`;
  - `backend/src/routes/publisher.ts`: PATCH `/books/:id`, POST
    `/books/:id/asset`, `/publish` and `/unpublish`.
- Test: `backend/test/integration/reports.test.ts`, in a new `describe`, or a
  new `portal-admin.test.ts`.

**Interfaces:**
- **Produces:**
  - `GET /api/v1/admin/publishers` returns
    `{ publishers: Array<{ id: string; name: string }> }`, sorted by name, for
    admins only.
  - `function bookWriteScope(req): string | null`, private, in
    `publisher.ts`. It returns `tenantFilter(req)` for publishers. For admins
    it returns `publisherScopeQuerySchema.parse(req.query).publisherId ?? null`,
    so an admin who names a publisher is checked against it.
- **Behaviour:** all four book write routes use `bookWriteScope(req)` in their
  `($n::uuid IS NULL OR publisher_id = $n)` filter, so the wrong publisher
  gets a 404. `/publish` currently runs its final `UPDATE` without the scope;
  add the scope there too.

- [ ] **Step 1: Write failing tests.**
  - `'lists publishers for admins only'`: an admin gets both, sorted by name;
    publisher staff and readers get 403.
  - `'an admin naming a publisher cannot edit another publisher's book'`: an
    admin calling `PATCH /publisher/books/<B's book>?publisherId=<A>` gets 404
    and the title is unchanged. The same holds for `/unpublish`.
  - `'an admin without publisherId can still edit any book'`: the existing
    behaviour is kept.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** the tests, then the full integration suite, including
  `publisher-isolation.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(admin): publisher list and picked-publisher check on book writes`.

---

### Task 5: Portal cookie login, forged-request check and CORS

**Files:**
- Create:
  - `backend/src/middleware/cors.ts`;
  - `backend/src/auth/portal-session.ts`.
- Modify:
  - `backend/src/config/env.ts`: `CORS_ORIGINS`, `PORTAL_SESSION_HOURS`
    (default 12), `PORTAL_REMEMBER_DAYS` (default 30);
  - `backend/src/auth/tokens.ts`: `signAccessToken` takes an optional
    `expiresIn`;
  - `backend/src/middleware/auth.ts`;
  - `backend/src/routes/auth.ts`;
  - `backend/src/app.ts`: mount `cors` right after `requestContext`;
  - `backend/src/middleware/errors.ts`: add `PORTAL_ACCESS_DENIED` and
    `CSRF_CHECK_FAILED`;
  - `.env.example` and `backend/.env.example`.
- Test:
  - `backend/src/middleware/cors.test.ts`;
  - `backend/src/auth/portal-session.test.ts`;
  - `backend/src/config/env.test.ts`;
  - `backend/test/integration/portal-auth.test.ts` (new).

**Interfaces:**
- **Produces (`portal-session.ts`):**
  - `export const PORTAL_COOKIE = 'libraria_portal'`
  - `export const PORTAL_HEADER = 'x-libraria-portal'`
  - `export function readCookie(header: string | undefined, name: string): string | null`
    parses the `Cookie` header with no dependency.
  - `export function sessionCookie(token: string, rememberMe: boolean): string`
    returns the full `Set-Cookie` value.
  - `export function clearedCookie(): string` returns `Max-Age=0`.
- **Produces (`auth.ts`):** `requireAuth` reads the Bearer token first, then
  the cookie. When it authenticates from the cookie:
  - it sets `req.authSource = 'cookie'`, declaring the `Request` augmentation
    next to the existing `req.auth` one;
  - it rejects non-safe methods that lack `X-Libraria-Portal: 1` with
    `403 CSRF_CHECK_FAILED`.
- **Produces (`routes/auth.ts`):**
  - `POST /portal/login` takes `{ email, password, rememberMe?: boolean }`.
    It checks the password with the existing logic (keep the `DUMMY_HASH`
    timing protection by extracting a shared `verifyCredentials`). Readers
    get `403 PORTAL_ACCESS_DENIED`. On success it sets the cookie and returns
    `{ user }` with no token.
  - `POST /portal/logout` clears the cookie and returns 204. It needs no auth
    and is idempotent.
  - `GET /me` already uses `requireAuth`, so it works with the cookie.
- **Produces (`cors.ts`):** `export function cors(allowed: string[]): RequestHandler`.
  - When the `Origin` header is in `allowed`, it sets:
    - `Access-Control-Allow-Origin` to that origin;
    - `Access-Control-Allow-Credentials: true`;
    - `Vary: Origin`;
    - and on OPTIONS: `Access-Control-Allow-Methods: GET,POST,PATCH,PUT,DELETE`,
      `Access-Control-Allow-Headers: Content-Type,X-Libraria-Portal,X-Request-Id`
      and a 204 response.
  - Any other origin gets no CORS headers; an OPTIONS request from it gets a
    plain 204 without them.

- [ ] **Step 1: Write failing tests.**
  - **Unit:**
    - `readCookie('a=1; libraria_portal=tok; b=2', 'libraria_portal')` → `'tok'`, and a missing cookie → `null`;
    - `sessionCookie('t', true)` contains `HttpOnly`, `SameSite=Lax`,
      `Path=/api` and `Max-Age=2592000`;
    - `sessionCookie('t', false)` has no `Max-Age`;
    - `Secure` appears only when `NODE_ENV=production` (test through a
      parameter, not a global);
    - CORS: an allowed origin gets credentials headers, and another origin
      gets none;
    - `parseEnv` turns `CORS_ORIGINS: 'https://a.example, https://b.example'`
      into two origins.
  - **Integration (`portal-auth.test.ts`):** create users with a real bcrypt
    hash through a local helper.
    - `'publisher logs in with a cookie and no token in the body'`:
      - the response has a `set-cookie` that includes `HttpOnly`;
      - `body.token` is undefined;
      - `GET /auth/me` with that cookie returns 200.
    - `'readers are refused'`: 403 `PORTAL_ACCESS_DENIED` and no
      `set-cookie`.
    - `'remember me sets a 30-day cookie'`.
    - `'cookie writes need the portal header'`:
      - `PATCH /publisher/books/:id` with the cookie and no header gets 403
        `CSRF_CHECK_FAILED`;
      - with `X-Libraria-Portal: 1` it gets 200;
      - a cookie GET without the header gets 200.
    - `'logout clears the cookie'`: the `set-cookie` has `Max-Age=0`.
    - `'mobile bearer requests are unaffected'`: a Bearer PATCH without the
      header gets 200.
    - `'wrong password still costs a bcrypt compare'`: unknown email and
      wrong password both return 401 `INVALID_CREDENTIALS`.

- [ ] **Step 2: Run** the unit and integration tests. Expected: FAIL.

- [ ] **Step 3: Implement.** Document the three env settings in both `.env.example` files.

- [ ] **Step 4: Run** the tests, then the full backend verification (lint, typecheck, unit, integration, build). Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(auth): portal cookie session with forged-request check and CORS allowlist`.

---

### Task 6: Portal scaffold, languages, login and layout

**Files:**
- Create `portal/` with:
  - `package.json`, with these scripts:
    - `dev: vite`;
    - `build: tsc -b && vite build`;
    - `typecheck: tsc -b --noEmit`;
    - `lint: biome check`;
    - `test: vitest run`.
  - `index.html`, `vite.config.ts` (proxying `/api` to
    `http://localhost:3000`, with the Vitest `jsdom` environment),
    `tsconfig.json` (strict), and `biome.json` (copied from the backend's
    formatter and linter settings, `vcs.root: ".."`).
  - `src/main.tsx` and `src/App.tsx`, holding the router.
  - `src/styles.css`, with the tokens `--blue: #2563EB` and
    `--green: #059669` and a grey scale.
  - `src/api/client.ts`, `src/api/types.ts` and `src/api/auth.ts`.
  - `src/auth/AuthProvider.tsx` and `src/auth/RequireAuth.tsx`.
  - `src/i18n/index.ts`, `src/i18n/en.json`, `src/i18n/sq.json` and
    `src/i18n/i18n.test.ts`.
  - `src/lib/format.ts` and `src/lib/format.test.ts`.
  - `src/lib/periods.ts` and `src/lib/periods.test.ts`.
  - `src/layout/AppLayout.tsx`, `src/layout/PublisherScope.tsx` and
    `src/layout/LanguageSwitcher.tsx`.
  - `src/pages/LoginPage.tsx` and `src/pages/LoginPage.test.tsx`.
- Modify: `.github/workflows/ci.yml`. Add a `portal` job, a copy of the
  `mobile` job with `working-directory: portal`, running `npm ci`, `lint`,
  `typecheck`, `test` and `build`.

**Interfaces:**
- **`client.ts`:**
  - `export class ApiError extends Error { status: number; code: string }`
  - `export async function api<T>(path: string, init?: RequestInit & { query?: Record<string, string | undefined> }): Promise<T>`
    - It always uses `credentials: 'include'` and the
      `X-Libraria-Portal: 1` header.
    - The base is `import.meta.env.VITE_API_BASE ?? '/api/v1'`.
    - A 401 response emits a `libraria:unauthorized` window event.
- **`AuthProvider`:**
  - `useAuth(): { status: 'loading' | 'anonymous' | 'authenticated'; user: PortalUser | null; login(email, password, rememberMe): Promise<void>; logout(): Promise<void> }`
  - On mount it calls `GET /auth/me`. A reader is treated as `anonymous`,
    with a `PORTAL_ACCESS_DENIED` notice.
- **`PublisherScope`:**
  - `usePublisherScope(): { publisherId: string | undefined; setPublisherId(id: string): void; isAdmin: boolean }`
  - For admins, the pick is remembered in `localStorage` (wrapped in
    try/catch). Every report and book call adds `publisherId` when it is set.
- **`i18n/index.ts`:**
  - `export const LANGUAGES = ['sq', 'en'] as const`
  - `export function initialLanguage(stored: string | null, browser: readonly string[]): 'sq' | 'en'`
    returns the stored choice if valid, else `'sq'` if any browser language
    starts with `sq`, else `'en'`.
  - `export function localeFor(lang): 'sq-AL' | 'en-IE'`
- **`format.ts`:**
  - `formatMoney(cents: number, lang)`
  - `formatDate(iso: string, lang)` formats in UTC.
  - `countryName(code: string | null, lang)` returns the translated
    "Unknown" for null.
  - `formatPercentBps(bps: number, lang)`
- **`periods.ts`:**
  - `type PresetId = 'this_month' | 'last_month' | 'last_90_days' | 'this_year'`
  - `presetRange(id, today: Date): { from: string; to: string }` in UTC,
    with `to` exclusive.
  - `previousRange(range): { from; to }` has the same length and ends at
    `range.from`.
  - `granularityFor(range): 'day' | 'week' | 'month'`: up to 62 days gives
    `day`, up to 366 gives `week`, more gives `month`.
- **`AppLayout`:**
  - the sidebar groups "Money" (Overview, Sales, Earnings), "Catalogue"
    (Books, + New book) and "Account" (Contract);
  - the top bar holds the publisher name or the admin picker (fed by
    `GET /admin/publishers`), the `LanguageSwitcher` and Log out.
  - Pages are lazy placeholders until Tasks 7–8.

- [ ] **Step 1: Scaffold** with `npm create vite@latest portal -- --template react-ts`. Add the dependencies listed in the Tech Stack, and confirm `npm run build` works on the untouched template.

- [ ] **Step 2: Write failing tests.**
  - **`i18n.test.ts`:**
    - the key sets of `en.json` and `sq.json`, flattened, are equal and
      non-empty;
    - `initialLanguage(null, ['sq-AL','en'])` → `'sq'`;
    - `initialLanguage(null, ['de'])` → `'en'`;
    - `initialLanguage('en', ['sq'])` → `'en'`;
    - `initialLanguage('xx', ['sq'])` → `'sq'`.
  - **`format.test.ts`:**
    - `formatMoney(123450, 'en')` contains `€1,234.50`;
    - `formatMoney(123450, 'sq')` contains `1.234,50` and `€`, comparing
      with non-breaking spaces normalised;
    - `countryName('XK', 'sq')` is non-empty and not `'XK'`;
    - `countryName(null, 'en')` → `'Unknown'`.
  - **`periods.test.ts`:**
    - `presetRange('this_month', new Date('2026-11-13T10:00:00Z'))` → `{from:'2026-11-01', to:'2026-12-01'}`;
    - `previousRange` of that → `{from:'2026-10-01', to:'2026-11-01'}`, for
      a range of the same 31 days. (Ruling to record: previous = the same
      number of days immediately before.)
    - `granularityFor` boundaries.
  - **`LoginPage.test.tsx`,** with `fetch` stubbed:
    - submitting calls `POST /api/v1/auth/portal/login` with `rememberMe`;
    - a `PORTAL_ACCESS_DENIED` response shows the translated
      "portal is for publishing partners" text;
    - switching the language to Albanian re-renders the labels in Albanian.

- [ ] **Step 3: Run** `cd portal && npm test`. Expected: FAIL.

- [ ] **Step 4: Implement** the files above. Write all strings in both JSON files, giving Albanian text for every key.

- [ ] **Step 5: Run** `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Expected: all PASS.

- [ ] **Step 6: Commit**, but only if authorised: `feat(portal): bilingual portal scaffold with cookie login and layout`.

---

### Task 7: Money pages: Overview, Sales and Earnings

**Files:**
- Create:
  - `portal/src/api/reports.ts`;
  - `portal/src/components/PeriodPicker.tsx`, `Kpi.tsx`, `SalesChart.tsx`,
    `DataState.tsx` (loading, error with retry, and empty states);
  - `portal/src/pages/OverviewPage.tsx`, `SalesPage.tsx`,
    `EarningsPage.tsx`;
  - `portal/src/pages/pages.test.tsx`.

**Interfaces:**
- **Consumes:** the Task 2 and Task 3 endpoints and their `Metrics` and
  `SalesLine` shapes, mirrored in `portal/src/api/types.ts`. Also `api`,
  `usePublisherScope`, `format.ts` and `periods.ts` (Task 6).
- **Produces:**
  - `useSummary(range, granularity)`, `useByBook(range)`,
    `useByCountry(range)` and `useSales(filters)`, all React Query hooks
    keyed by `publisherId` and their filters.
  - `salesCsvUrl(filters, lang): string`, used by a plain `<a download>` link.
    Since the cookie is same-site, the browser sends it.
- **Pages:**
  - **Overview:**
    - the period picker, with presets and a custom range;
    - four KPIs (gross, copies, refunds, earnings), each with the % change
      against `previousRange`, or "—" when the previous value is 0;
    - a gross-over-time chart from `series`;
    - the top 5 books from `/by-book`.
  - **Sales:**
    - filters (period, book, country including "Unknown", status);
    - a paginated table showing date, book, country, status, price, VAT, fee,
      commission %, commission, earnings and refunded;
    - lines whose `split` is `'pending'` or `'no_rate'` show the translated
      "Fee pending" or "Not split (sold before your contract)" labels;
    - an "Export CSV" link in the current language.
  - **Earnings:**
    - a view toggle (by month / by book / by country);
    - **by month** shows the rows: Gross sales, − VAT, − Payment fees,
      = Net, − Libraria commission, − Not yet split, = Earnings at sale,
      − Refund reversals, = Earnings. Each value is a `Metrics` field taken
      as-is, never computed in the browser;
    - refunded gross is shown beside the table as information;
    - a translated note says VAT and fees are shown as at the time of sale;
    - **by book** and **by country** are tables of the same metrics.

- [ ] **Step 1: Write failing tests** in `pages.test.tsx`, with `fetch` stubbed by fixture JSON:
  - Overview renders `formatMoney(totals.earningsCents)` and the top book's
    title.
  - Sales renders a `pending` line with the "Fee pending" label, and the CSV
    link includes `lang=sq` when the language is Albanian.
  - The Earnings "by month" table shows each `Metrics` field from the
    fixture unchanged.
  - A failed request shows the retry state, not a blank page.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement.** Add every new string to both language files.

- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint` and `npm run build`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): overview, sales ledger and earnings pages`.

---

### Task 8: Catalogue and contract pages, README and full verification

**Files:**
- Create:
  - `portal/src/api/books.ts`;
  - `portal/src/pages/BooksPage.tsx`, `BookFormPage.tsx` (one page for both
    new and edit), `ContractPage.tsx`;
  - `portal/src/pages/catalogue.test.tsx`.
- Modify: `README.md`. Add a Portal section covering:
  - running it (`cd portal && npm ci && npm run dev`, with the API on :3000);
  - the cookie login, and that the portal and the API must share a site in
    production;
  - the `CORS_ORIGINS`, `PORTAL_SESSION_HOURS` and `PORTAL_REMEMBER_DAYS`
    settings;
  - the reporting rules (UTC, refunds counted in the sale's period, VAT and
    fees as at sale time, line status);
  - the CSV export;
  - a note that Albanian text needs a native review before launch.

  Also list the new endpoints in the Payments and Policies section.

**Interfaces:**
- **Consumes:** the existing `GET/POST /publisher/books`,
  `GET/PATCH /publisher/books/:id`, `POST /publisher/books/:id/publish` and
  `/unpublish`, and `GET /publisher/contract`. Admin writes include
  `publisherId` (Task 4).
- **Pages:**
  - **Books:**
    - a search box and a status filter (all, published, draft);
    - a table showing title, status, price, copies (`metrics.salesCount`)
      and earnings (`metrics.earningsCents`).
  - **BookForm:** the fields `title`, `author`, `isbn13`, `description`,
    `genre`, `language`, `priceCents`, `coverImageUrl` and `mediaType`.
    - **Price** is entered in euros and converted to integer cents by string
      parsing, not float multiplication. `"9,99"` and `"9.99"` both give 999.
      Add this as `parseEuroInput(text: string): number | null` in
      `format.ts`, with unit tests.
    - **Publish:** an `ASSET_REQUIRED` response shows the translated message
      that file upload is coming soon. Unpublish is offered on live books.
    - **Validation:** `VALIDATION_FAILED` details are shown next to their
      fields.
  - **Contract:** the current rate as a percentage, its start date and
    reference, and the history table. `current: null` shows a translated
    "No active contract. Contact Libraria" message.

- [ ] **Step 1: Write failing tests:**
  - `parseEuroInput`:
    - `'9,99'` and `'9.99'` both give 999;
    - `'10'` gives 1000;
    - `'0,5'` gives 50;
    - `'abc'`, `'1.234,5'` and `'-1'` all give null.
  - Books renders the earnings figure from the fixture.
  - Publishing a book without a file shows the upload-coming message.
  - The Contract page shows 20% and the no-contract state.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.

- [ ] **Step 3: Implement** the pages and README. Add every string to both language files.

- [ ] **Step 4: Full verification:**
  - `backend/`: `npm run lint`, `npm run typecheck`, `npm test`,
    `npm run test:integration` and `npm run build`;
  - `portal/`: `npm run lint`, `npm run typecheck`, `npm test` and
    `npm run build`;
  - `mobile/`: `npm run typecheck`.

  Expected: every command exits 0. Report the test counts.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): catalogue and contract pages; docs`.
