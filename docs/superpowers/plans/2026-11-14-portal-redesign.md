# Publisher Portal Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the publisher portal's presentation layer as a cohesive,
editorial, information-dense publishing back office on real data, with a few
additive read-only backend extensions.

**Architecture:**
- **Backend:** additive read-only extensions first (sales fields and search,
  an orders route, book status/sort/filter, per-book summary, contract
  status).
- **Portal:** a new `portal/src/ui/` component library on CSS tokens and Radix
  primitives, then a new shell with navigation and a URL-shared date range,
  then each page rebuilt from `ui/` components.
- **Kept as is:** the API layer, auth, scoping (ScopeGate/usePublisherScope),
  TanStack Query hooks and i18n.

**Tech Stack:**
- **Portal:** Vite, React 19, TypeScript (strict), React Router 7,
  TanStack Query 5, i18next, Recharts. New: `@radix-ui/*` primitives,
  `@fontsource/inter`, `@fontsource/instrument-serif`. Tests: Vitest,
  Testing Library, and `vitest-axe` (or `@axe-core/react`, builder's choice;
  state it).
- **Backend:** Express 5, PostgreSQL, node:test.

**Spec:** `docs/superpowers/specs/2026-11-14-portal-redesign-design.md`.
Colours and type are also in "Libraria — Publisher Portal UI/UX Scope" §4,
mirrored in the spec.

## Global Constraints

- **Tokens:**
  - `--bg #F5F2EA`, `--surface #FFFEFA`, `--text #25251F`, `--text-2 #85847C`,
    `--border #DEDAD0`, `--accent #263D32`, `--accent-2 #793E43`;
  - state tints derived from these;
  - no blue accents, gradients or heavy shadows (shadows only on floating
    layers);
  - radius 6 px for controls and 8 px for panels;
  - 1 px borders;
  - an 8 px spacing grid (4 px half-steps);
  - type scale 12/13/14/16/20/28 px (one hero figure may be larger).
- **Fonts:** Inter for the interface; Instrument Serif only for the brand
  mark and page titles (h1). **The spec's "Checkpoint 1 rulings" section
  overrides this plan wherever they differ** (serif, radii, line-height,
  top bar, charts, comparisons, month capitals).
  `font-variant-numeric: tabular-nums` on every number. Both fonts
  self-hosted through @fontsource, with no font CDN.
- **No component kit and no Tailwind.** Radix UI primitives are allowed
  (Dialog, Popover, DropdownMenu, Tabs, Tooltip, ToggleGroup). Styling is CSS
  modules plus the tokens.
- **No money computed in the browser:** formatting and % change only. Sorting,
  filtering and searching are server-side through the extensions in Tasks 1–2.
- **No mock or placeholder figures.** Payouts and balances render
  `NotSetUpState`, with no numbers.
- **Translations:** every user-visible string is in both
  `portal/src/i18n/en.json` and `sq.json` (natural Albanian), and the
  identical-keys test passes.
- **Accessibility:** WCAG 2.2 AA contrast; keyboard navigation with a visible
  focus ring (2 px `--accent`); status never shown by colour alone (icon or
  shape plus label); `prefers-reduced-motion` honoured. Every data view
  handles loading, empty, error, partial data, permission denied (ScopeGate)
  and stale data ("Last updated" plus refetch on focus).
- **Preserve behaviour:**
  - API contracts are only added to, never changed;
  - auth/cookie, the admin publisher scope, the EPUB upload and activation
    flow, publish and unpublish, and CSV export all behave as today;
  - existing test behaviour assertions are kept, and only selectors change
    with the markup.
- **Backend extensions:** read-only, additive, scoped to the publisher like
  the existing reports, built on `salesBase`; never expose other publishers'
  items or order-level refund amounts.
- **Commits and Docker:** do not commit or push unless the user asks. Keep
  Docker checks quick.
- **Done means** all of these pass:
  - `backend/`: lint, typecheck, `npm test`, `npm run test:integration`,
    build;
  - `portal/`: lint, typecheck, `npm test`, build;
  - `mobile/`: typecheck.

## Review Focus

1. **An admin switches publisher with a range in the URL.** There must be no
   cross-publisher cache bleed, and filters reset (ScopeGate keying). Tested in
   Task 4.
2. **Book data that breaks layouts:** very long titles, a missing cover, a
   null ISBN, zero sales. The grid and table must not break, the typographic
   cover fallback must show, and missing values show "—". Tested in Task 6.
3. **A hand-edited URL range** (to before from, more than 3 years, garbage).
   It must fall back to the default range with no repeated 400s. Tested in
   Task 4.
4. **A statement month over the CSV cap.** That row shows the inline
   `EXPORT_TOO_LARGE` message and offers its weeks; other rows are unaffected.
   Tested in Task 8.
5. **Keyboard-only use** of the sidebar drawer, side panel and dialogs. Focus
   is trapped and then returned, Esc closes, and nothing hidden is focusable.
   Tested in Tasks 3 and 7.

---

### Task 1: Backend read extensions for reports (sales fields, search, orders, per-book summary)

**Files:**
- Modify:
  - `backend/src/reports/base.ts`: add the columns (`item_id` already
    exists; add `refunded_at` and the at-sale/reversed share columns) and the
    `q` filter;
  - `backend/src/routes/reports.ts`: the `/sales` and `/sales.csv` additions,
    the new `/orders`, and `bookId` on `/summary`.
- Test: `backend/test/integration/reports.test.ts`.

**Interfaces:**
- **Produces:**
  - `SalesLine` gains `itemId: string; refundedAt: string | null; commissionAtSaleCents: number; commissionReversedCents: number; earningsAtSaleCents: number; earningsReversedCents: number`.
    The existing `commissionCents`/`earningsCents` keep their after-reversal
    meaning.
  - `/sales`, `/sales.csv` and `/orders` accept `q` (trimmed, 1–100
    characters): `ILIKE` on the item title snapshot, OR `transaction_id::text
    ILIKE q || '%'`, parameterised with LIKE metacharacters escaped.
  - `GET /publisher/reports/orders?from&to&bookId?&country?&status?&q?&page&limit`
    (limit at most 100) returns
    `{ orders: Array<{ transactionId: string; paidAt: string; lines: SalesLine[] }>, pagination: {page,limit,total,totalPages} }`.
    It is paginated by distinct transaction (newest `paid_at` first, ties
    broken by transaction id) and contains only this publisher's lines.
  - `/summary` accepts an optional `bookId` (a lowercase uuid).

- [ ] **Step 1: Write failing tests:**
  - **New line fields:** after a partial refund, `refundedAt` is set and
    `earningsAtSaleCents - earningsReversedCents === earningsCents`.
  - **Search:** `q` matches by title (case-insensitive), matches by a
    transaction-id prefix, `q='%'` matches nothing special (it is escaped),
    and the CSV respects `q`.
  - **Orders:**
    - a multi-book order from one publisher returns one order with two lines;
    - in a multi-publisher order, publisher A sees only A's lines;
    - pagination counts orders, not lines (3 orders × 2 lines with `limit=2`
      gives 2 orders and `total=3`);
    - another publisher's spoofed `publisherId` is ignored.
  - **Per-book summary:** `/summary?bookId` totals equal that book's
    `/by-book` row for the same range.

- [ ] **Step 2: Run** `cd backend && npx tsx --test --test-concurrency=1 test/integration/reports.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**, reusing `salesBase`. No second definition of the rules.

- [ ] **Step 4: Run** the file, then the full backend verification. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(reports): order view, search and per-book summary for the portal`.

---

### Task 2: Backend read extensions for catalogue and contract (book status, sort, filter; contract status)

**Files:**
- Modify:
  - `backend/src/routes/publisher.ts`: `GET /books`;
  - `backend/src/commerce/rates.ts`: `CommissionRate.status`.
- Test:
  - `backend/test/integration/portal-admin.test.ts`, or a new
    `catalog.test.ts`;
  - the contract tests in `commission.test.ts`.

**Interfaces:**
- **Produces:**
  - Book list items gain
    `status: 'draft'|'processing'|'ready'|'published'|'withdrawn'` and
    `latestAsset: { state: string; reasonCode: string | null } | null`. The
    status is derived server-side:
    - `withdrawn` if `withdrawn_at`;
    - else `published` if `is_available`;
    - else `processing` if any asset is in a non-terminal state;
    - else `ready` if there is a ready current asset;
    - else `draft`.
  - `GET /books` accepts:
    - `status` (those five values; the legacy `all|published|draft` keep
      working);
    - `sort` in `updated|title|copies|earnings|price` (default `updated`);
    - `order` in `asc|desc` (default `desc`, `asc` for title).

    Pagination stays server-side.
  - `CommissionRate` gains `status: 'active'|'scheduled'|'superseded'`:
    `active` when `inForce`, `scheduled` when `effectiveFrom > now`, else
    `superseded`. This applies to the admin and publisher contract responses.

- [ ] **Step 1: Write failing tests:**
  - each status derivation case;
  - the status filter returns only matching books;
  - sorting by copies and earnings across a 3-book fixture gives the right
    order;
  - legacy `status=draft` still works;
  - the contract with a future rate returns `scheduled`, the in-force one
    `active`, and an older one `superseded`.

- [ ] **Step 2: Run** the test files. Expected: FAIL.

- [ ] **Step 3: Implement.** `sort` maps to a whitelist of ORDER BY clauses; user text never reaches SQL.

- [ ] **Step 4: Run** the tests, then the full backend verification. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(publisher): book status, sorting and contract status`.

---

### Task 3: Design system foundation and the `ui/` component library

**Files:**
- Create:
  - `portal/src/ui/tokens.css`, with fonts and globals;
  - `portal/src/ui/*` components, each with a `.module.css`:
    - `Button`, `IconButton`, `StatusBadge`;
    - `Figure`, `FigureRow`;
    - `DataTable`;
    - `FilterBar`, `SearchInput`, `Select`, `SegmentedControl`,
      `DateRangePicker`;
    - `BookCover`, `BookCard`;
    - `SidePanel`, `Dialog`, `Tabs`;
    - `FormSection`, `Field`, `FileDrop`, `Stepper`;
    - `LineChart`, `BarChart` (Recharts wrappers);
    - `EmptyState`, `LoadingState`, `ErrorState`, `NotSetUpState`;
    - `LastUpdated`;
  - `portal/src/ui/index.ts`;
  - `portal/src/ui/ui.test.tsx`.
- Modify: `portal/package.json` (Radix primitives, fontsource, axe tool),
  `portal/src/main.tsx` (import `tokens.css`), and remove the old
  `styles.css` rules as pages move over (final removal in Task 9).

**Interfaces:**
- **Produces**, with the props shown:
  - `StatusBadge({ tone: 'neutral'|'positive'|'pending'|'negative'|'info', icon?: ReactNode, children })`
    always renders text.
  - `Figure({ label, value: ReactNode, caption?: string, emphasis?: boolean })`:
    the caption carries the period and the gross/net/pending meaning.
  - `DataTable<T>({ columns: Array<{ key; header; cell: (row:T)=>ReactNode; align?: 'start'|'end'; sortKey?: string }>, rows: T[], rowKey, sort?: {key, order}, onSortChange?, onRowClick?, pagination?, stickyHeader?: boolean })`
    sorts through the callback only (server sorting) and scrolls horizontally
    instead of squashing.
  - `DateRangePicker({ value: {from,to}, onChange, presets })`, reusing
    `lib/periods.ts`.
  - `SidePanel({ open, onOpenChange, title, children })` and
    `Dialog({ open, onOpenChange, title, description?, children, actions })`
    are Radix Dialog-based, trap focus, close on Esc and return focus.
  - `BookCover({ title, src?: string|null, size: 'sm'|'md'|'lg' })`: a
    typographic fallback (initial, serif, muted tint) when `src` is null or
    fails to load.
  - `NotSetUpState({ title, body })` shows no figures.
  - Charts: `LineChart({ data, xKey, series, ariaLabel })` and `BarChart(...)`.
    Each renders an accessible text summary (`<figcaption>` or
    visually-hidden) and is always used next to a table of exact values.

- [ ] **Step 1: Write failing tests** in `ui.test.tsx`:
  - `StatusBadge` renders its label text, and the tone isn't the only
    signal (an icon or shape exists);
  - `DataTable` calls `onSortChange` with the key and order on a header
    click and renders numbers right-aligned;
  - `SidePanel`/`Dialog` (Review Focus 5) move focus inside on open, Esc
    closes, and focus returns to the trigger;
  - `BookCover` shows the fallback with the title's initial when `src` errors;
  - `Figure` renders its caption;
  - `NotSetUpState` contains no digits;
  - `DateRangePicker` presets call `onChange` with the `presetRange` output;
  - axe finds no violations on a composed sample (a table, a figure row, a
    badge).

- [ ] **Step 2: Run** `cd portal && npx vitest run src/ui`. Expected: FAIL.

- [ ] **Step 3: Implement.** Check `--text-2` on `--bg` contrast for 12–13 px text. If it fails AA, define `--text-2-strong` for small text and record the ruling in your report.

- [ ] **Step 4: Run** `npx vitest run src/ui`, `npm run typecheck`, `npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): design tokens and ui component library`.

---

### Task 4: Application shell, navigation, the shared URL date range, and login

**Files:**
- Create:
  - `portal/src/layout/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`
    (replacing `AppLayout.tsx`);
  - `portal/src/lib/useDateRange.ts`.
- Modify:
  - `portal/src/App.tsx`, for the routes;
  - `portal/src/pages/LoginPage.tsx`, restyled;
  - the i18n files;
  - existing tests' selectors.
- Test:
  - `portal/src/layout/shell.test.tsx`;
  - `portal/src/lib/useDateRange.test.ts`.

**Interfaces:**
- **Routes:**
  - `/` (Overview), `/catalog`, `/catalog/new`, `/catalog/:bookId` with tab
    sub-routes (`details`, `sales`, `analytics`, `distribution`, `files`),
    `/catalog/:bookId/edit`;
  - `/sales` (Sales & Orders), `/analytics`, `/earnings`, `/transactions`,
    `/payouts`, `/statements`, `/contracts`, `/settings`;
  - the old paths (`/books`, `/books/new`, `/books/:id`, `/contract`) redirect
    to the new ones.
- **Sidebar:**
  - groups and labels exactly as in the spec (Workspace, Financials,
    Organization);
  - collapsible on desktop, with the collapse state remembered in
    localStorage inside try/catch;
  - a Radix Dialog drawer below 900 px;
  - an active indicator that isn't colour alone (a bar plus weight).
- **TopBar:** page title context, `DateRangePicker` on range pages only, the
  admin publisher selector, `LanguageSwitcher` and the user menu (name/email,
  sign out).
- **`useDateRange()`:**
  - returns `{ range, setRange }`, synced to `?from&to`;
  - invalid, reversed, over-3-year or garbage values fall back to the default
    preset (this month) and rewrite the URL once (Review Focus 3);
  - pages pass `range` to their existing query hooks.
- **ScopeGate:** keying on `publisherId` stays, so an admin switching
  publisher resets page state (Review Focus 1).

- [ ] **Step 1: Write failing tests:**
  - the sidebar shows the three groups with their labels in en and sq;
  - the active route is marked with `aria-current="page"`;
  - the drawer opens and closes with the keyboard;
  - old routes redirect;
  - `useDateRange` parses a valid range, and falls back on a reversed one, a
    4-year one or `from=abc`;
  - an admin switching publisher refetches with the new `publisherId` and
    keeps the URL range;
  - login still posts `/auth/portal/login` and shows the translated errors.

- [ ] **Step 2: Run** `npx vitest run src/layout src/lib src/pages/LoginPage.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.** Existing pages render temporarily inside the new shell.

- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): new application shell and navigation`.

---

### Task 5: Overview and Analytics

**Files:**
- Rewrite: `portal/src/pages/OverviewPage.tsx`.
- Create: `portal/src/pages/AnalyticsPage.tsx`.
- Modify: `portal/src/api/reports.ts`, adding a `useOrders` hook used later,
  and `bookId` on `useSummary`.
- Test: `portal/src/pages/overview.test.tsx`, `analytics.test.tsx`.

**Interfaces:**
- **Overview:**
  - **Hero:** `earningsCents` for the range (Inter, with the period caption
    "Net publisher earnings, after VAT, fees, commission and refunds").
  - **Figure row:** gross (`grossCents`), units (`copies`), refunds
    (`refundsCents`), Libraria commission (`commissionCents`), each with %
    change against `previousRange` (text instead of a % when the previous
    value is zero; see Checkpoint 1 rulings).
  - **Payouts block:** `NotSetUpState` (pending and available, not set up).
  - **Chart:** a `BarChart` of daily gross or earnings (a `SegmentedControl`) from
    the summary series, with an exact-values table toggle.
  - **Top 5 books:** from `/by-book` with `BookCover`.
  - **Recent activity:** the latest 8 lines from `/sales` plus refunds
    (`refundedAt` desc) plus "Book updated" items from the books list sorted
    by `updated`, merged by timestamp; each type has its own icon.
  - **Action items:** books with status `draft` and no ready file, latest
    upload `rejected`, or `ready` but not published (from Task 2's fields),
    each linking to the book.
- **Analytics:**
  - Tabs: Trends (day/week/month), Books (bar plus table), Countries (bar
    plus table), Financial (commission, fees, refunds, reversals: the
    `Metrics` fields as a table plus a stacked bar).
  - Every chart is paired with exact values.

- [ ] **Step 1: Write failing tests,** with fixtures through stubbed fetch:
  - the hero shows `formatMoney(earningsCents)`;
  - the Payouts block contains no digits;
  - the activity list merges the three sources in timestamp order;
  - an action item appears for a rejected latest upload;
  - each Analytics tab renders its table values unchanged from the fixture;
  - the axe check passes.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): overview and analytics redesign`.

---

### Task 6: Catalog, book page and the add/edit flow

**Files:**
- Rewrite: `portal/src/pages/BooksPage.tsx` into `CatalogPage.tsx`, and
  `BookFormPage.tsx` into `BookEditorPage.tsx`.
- Create: `portal/src/pages/BookPage.tsx`, with the tabs.
- Restyle: `components/AssetPanel.tsx`, becoming the Files & DRM tab content
  built from `FileDrop`, `DataTable` and `StatusBadge`.
- Modify: `portal/src/api/books.ts` (`status`, `sort`, `order`).
- Test: `portal/src/pages/catalog.test.tsx`, which replaces or extends the
  existing tests and keeps their behaviour assertions.

**Interfaces:**
- **Catalog:**
  - a `SegmentedControl` for grid or table, remembered in localStorage inside
    try/catch;
  - `SearchInput` (the existing server `search`);
  - a status filter (draft, processing, ready, published, withdrawn) and
    sort (updated, title, copies, earnings, price), all server-side;
  - **Grid:** `BookCard` with cover, title (Inter), author, status badge,
    price, copies and earnings.
  - **Table:** cover thumbnail, title, author, ISBN, status, price, copies,
    earnings, last updated.
- **Book page:**
  - a header with cover, title, status and the primary action (Edit);
  - **Details:** metadata, read only.
  - **Sales:** that book's lines through the `/sales?bookId` table.
  - **Analytics:** `/summary?bookId` trend plus a table.
  - **Distribution:** status, publish and unpublish (the existing calls and
    error handling, including `ASSET_REQUIRED` and withdrawn 403), and the
    withdrawn notice.
  - **Files & DRM:** the asset panel.
- **Editor:**
  - a `Stepper` over the five sections with the spec's completion rules;
  - inline field errors from `VALIDATION_FAILED` details;
  - Save draft (create, then patch);
  - a preview `BookCard` in reader-style typography;
  - **Files:** EPUB upload once the draft exists, plus the cover URL field;
  - **Distribution & protection:** read only, with publish actions and the
    DRM explanation.
  - Price uses the existing `parseEuroInput`.

- [ ] **Step 1: Write failing tests:**
  - the grid and table toggle persists;
  - sort and status send the server params (`sort=earnings&order=desc`,
    `status=processing`);
  - **Review Focus 2:** a 300-character title, a null cover, a null ISBN and
    0 sales render without overflow errors, with the fallback cover and "—"
    shown;
  - book page tabs route and render (Files tab: an upload still sends the
    raw `application/epub+zip`; activation still confirms);
  - the stepper marks sections complete per the rules;
  - Save draft creates first and patches next time;
  - `ASSET_REQUIRED` and withdrawn publish errors are translated;
  - the axe check passes.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): catalog, book page and editor redesign`.

---

### Task 7: Sales & Orders and the Transactions ledger

**Files:**
- Rewrite: `portal/src/pages/SalesPage.tsx` into `SalesOrdersPage.tsx`.
- Create:
  - `portal/src/pages/TransactionsPage.tsx`;
  - `portal/src/components/SaleBreakdown.tsx`, the side panel content.
- Test: `portal/src/pages/sales.test.tsx`.

**Interfaces:**
- **Sales & Orders:**
  - `useOrders` (Task 1's route) in a `DataTable`, one row per order: date,
    transaction reference (short), books (count plus first title), each
    line's status as badges, gross, earnings;
  - search `q`, a book filter, a status filter, the URL range;
  - Export CSV (existing, with `q` included).
  - Clicking a row opens the `SidePanel` with `SaleBreakdown` for each line:
    price, VAT, payment fee, commission at sale, earnings at sale, refunded
    amount, reversals, earnings, split state, `paidAt`, `refundedAt`. Values
    are exactly the API's; no order-level status roll-up.
- **Transactions:** the line-level ledger with the same filters, pagination,
  the per-line breakdown panel and CSV export.

- [ ] **Step 1: Write failing tests:**
  - `q` and filters are sent to the server;
  - an order row with two lines opens a panel showing both lines' fixture
    values unchanged;
  - the panel's keyboard behaviour (Review Focus 5);
  - the CSV link includes `q`, the range, `lang` and the admin
    `publisherId`;
  - the Transactions pagination params;
  - a pending split line shows the translated "Fee pending" label;
  - the axe check passes.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): sales, orders and transactions redesign`.

---

### Task 8: Earnings, Payouts and Statements

**Files:**
- Rewrite: `portal/src/pages/EarningsPage.tsx`.
- Create: `portal/src/pages/PayoutsPage.tsx`, `StatementsPage.tsx`.
- Test: `portal/src/pages/financials.test.tsx`.

**Interfaces:**
- **Earnings:**
  - **Financial summary:** a ledger-style statement over the URL range with
    the same rows as today (gross, VAT, payment fees, net, commission at
    sale, not yet split, earnings at sale, refund reversals, earnings), each
    row with a one-line explanation and a "View transactions" link to
    `/transactions` with the same range.
  - The by-month, by-book and by-country views are kept.
  - **Balances:** `NotSetUpState` for pending, available and paid.
  - **Statements:** a link card to `/statements`.
- **Payouts:** a `NotSetUpState` explaining what will appear, and that
  earnings are recorded meanwhile. No figures.
- **Statements:**
  - a year selector and a Monthly or Annual `SegmentedControl`;
  - **Monthly:** one row per whole calendar month of the selected year (up to
    the current month, labelled "in progress"), with `/summary` totals for
    that month (gross, earnings) and a CSV download for exactly that month;
  - **Annual:** one `/summary` call per year, with backend totals;
  - **Review Focus 4:** an `EXPORT_TOO_LARGE` on a row's CSV shows the inline
    translated message and offers the month's weeks as separate downloads;
    other rows are unaffected;
  - a "PDF coming later" note.

- [ ] **Step 1: Write failing tests:**
  - the Earnings rows equal the fixture `Metrics` fields unchanged;
  - the "View transactions" link carries the range;
  - Payouts and Balances contain no digits;
  - Statements monthly rows call `/summary` with exact month bounds, and each
    CSV link has `from`/`to` equal to the month;
  - the current month is labelled "in progress";
  - an annual row uses its own year call;
  - a mocked 422 `EXPORT_TOO_LARGE` on one row shows the message and the
    weekly links, while the other rows stay normal;
  - the axe check passes.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): earnings, payouts and statements`.

---

### Task 9: Contracts and Settings, clean-up, README and full verification

**Files:**
- Rewrite: `portal/src/pages/ContractPage.tsx` into `ContractsPage.tsx`.
- Create: `portal/src/pages/SettingsPage.tsx`.
- Delete: the old `styles.css` rules, `AppLayout.tsx` and unused components
  (`Kpi`, `PeriodPicker` if replaced).
- Modify: `README.md` (the Portal section: navigation, design system notes,
  what is "not set up yet").
- Test: `portal/src/pages/org.test.tsx`.

**Interfaces:**
- **Contracts:** the current contract (rate as a percentage, start date,
  reference, a `StatusBadge` from the server `status`) and a history timeline
  or table; `current: null` keeps the existing translated "no active
  contract" message.
- **Settings:**
  - Account (email, display name: read only);
  - Language (the live switcher);
  - Session (sign out);
  - Organization: what exists, i.e. the publisher's commission contract link;
  - "Coming later" list items for team and roles, payment settings, and
    profile and storefront. These are text only, with no inert controls.

- [ ] **Step 1: Write failing tests:**
  - the contract status badges render the server `status`;
  - the no-contract state;
  - Settings shows the account read only, the language switch works, sign out
    calls logout, and there are no inputs in the "coming later" items;
  - the axe check passes.

- [ ] **Step 2: Run** the tests. Expected: FAIL.

- [ ] **Step 3: Implement and clean up.** No dead CSS or components remain (check with a grep of imports).

- [ ] **Step 4: Full verification:**
  - `backend/`: lint, typecheck, `npm test`, `npm run test:integration`,
    build;
  - `portal/`: lint, typecheck, `npm test`, build;
  - `mobile/`: typecheck.

  Expected: all exit 0. Report the counts.

- [ ] **Step 5: Commit**, but only if authorised: `feat(portal): contracts and settings; remove legacy styles`.
