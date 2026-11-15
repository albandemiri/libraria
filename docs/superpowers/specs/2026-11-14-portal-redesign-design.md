# Publisher Portal redesign: design

Status: ready for approval. Date: 2026-11-14. Branch: `phase-5/portal-redesign`, stacked on
`phase-4/book-assets`.

Inputs:
- the user's redesign brief (the conversation of 2026-11-14), which is the
  source for scope, navigation and the page list;
- "Libraria — Publisher Portal UI/UX Scope" (the PDF), which is the source for
  colours and typography and for its principles, interface states and
  accessibility targets.

Where the two differ, the user decided: **colours and typography follow the
PDF**, and **navigation follows the brief**.

## Why

The portal works, but it looks like a generic blue-and-white admin dashboard.
Publishing houses should get a back office that feels like a serious,
contemporary publishing tool. The central requirement, from both documents, is
that **publishers never have to guess where their money went**: every figure
is real, traceable, and reconcilable down to the transaction.

## Goals

- **A new design system:** tokens, type, spacing and components. It is warm,
  editorial and information-dense, and the whole portal uses it.
- **A new application shell and navigation:**
  - Workspace: Overview, Catalog, Sales & Orders, Analytics.
  - Financials: Earnings, Transactions, Payouts, Statements.
  - Organization: Contracts, Settings.
  - It keeps the Libraria branding, the admin publisher selector and the
    language switcher.
- **Every publisher page redesigned on real data:**
  - Overview;
  - Catalog (grid and table);
  - book detail (Details, Sales, Analytics, Distribution, Files & DRM);
  - add/edit book;
  - Sales & Orders with a side panel;
  - Analytics, Earnings, Transactions, Statements, Contracts, Settings;
  - Payouts and balances shown honestly as "not set up yet".
- **No regressions.** All existing features, API contracts, authentication,
  the Albanian/English translations and the financial figures behave as they
  do today.

## Non-goals (later projects)

- **The payout process and its balances:** pending, available and paid;
  upcoming payouts; payout history. The user chose option (c): the pages exist
  but show a clear state saying payouts are not set up yet. Nothing is
  invented.
- **Team members and roles** (Owner, Finance, Catalogue, Analyst). These need
  email sending and backend roles.
- **Payment method per sale and discounts.** We have no data for either.
  Columns for them are left out rather than shown empty.
- **The publisher profile and storefront preview.** There are no backend
  fields for logo, banner or description yet.
- **PDF statements.** This version offers CSV statements; PDF comes later.
- **Backend changes beyond the additive read extensions listed below.**
  allowed only if a page cannot be built from existing endpoints, and must be
  recorded as a ruling.

## Anti-goals

- No mock, placeholder or demo figures anywhere.
- No financial calculation in the browser. The page shows what the backend
  computed; the existing rule ("only formatting and % change") still applies.
- No generic SaaS look:
  - no blue accents, gradients, heavy shadows or big rounded cards;
  - no decorative illustrations;
  - no walls of identical metric cards;
  - no oversized type.
- No status shown by colour alone (WCAG).
- No new English-only strings: everything goes through both the `en` and `sq`
  translation files.

## Design system

**Colours, from the PDF.** These are CSS custom properties on `:root`.

| Token | Value |
| --- | --- |
| `--bg` | `#F5F2EA` |
| `--surface` | `#FFFEFA` |
| `--text` | `#25251F` |
| `--text-2` | `#85847C` |
| `--border` | `#DEDAD0` |
| `--accent` | `#263D32` (deep green: primary actions, active nav, focus) |
| `--accent-2` | `#793E43` (burgundy: emphasis, editorial highlights, destructive actions in a darker tint) |

Derived tints, used only for state badges, hover and selection:
- 4–8% alphas of `--text`;
- a green tint for live/paid;
- an amber tint for processing/pending, hue-adjusted to stay warm;
- a burgundy tint for rejected/failed.

All text/background pairs must meet WCAG 2.2 AA contrast. `--text-2` on
`--bg` is checked, and darkened slightly if it fails for small text, with the
ruling recorded.

**Typography:**
- Inter for the interface, tables and figures, with
  `font-variant-numeric: tabular-nums` on every number.
- Instrument Serif only for the brand mark and the page title (the h1 at
  the top of each page). Everything else, including the net earnings figure,
  empty-state headings, panel titles and book titles, uses Inter (checkpoint 1
  ruling).
- Both are self-hosted via `@fontsource`, with no third-party font CDN.
- Scale: 12/13/14/16/20/28 px. Base UI text is 13–14 px. No display sizes
  above 28 px except the single hero figure on Overview.

**Space and shape:**
- an 8 px spacing grid (4 px half-steps for dense tables);
- 1 px borders;
- radius 6 px for controls and 8 px for panels; no pill-shaped cards;
- shadows only on floating layers (menus, side panel, dialogs).

**Motion:** 120–180 ms ease-out for hover and panels, turned off under
`prefers-reduced-motion`.

## Components (`portal/src/ui/`)

These are reused everywhere, and pages build only from them:
- `AppShell`, `Sidebar` (collapsible on desktop, a drawer on small screens),
  `TopBar` (page context, date range where relevant, publisher selector,
  language switcher, user menu);
- `PageHeader` (title, short description, primary action);
- `FigureRow` and `Figure`: a financial summary strip, not a wall of cards.
  Each figure carries its meaning, currency, period and its gross, net or
  pending status, as the PDF requires;
- `DataTable` (sorting, sticky header, numeric columns aligned right,
  pagination, row click, horizontal scroll rather than squashing columns);
- `FilterBar`, `SearchInput`, `Select`, `DateRangePicker`, `SegmentedControl`;
- `StatusBadge` (an icon or shape plus a label plus a tint, never colour
  alone);
- `BookCover`: the real cover image with a generated typographic fallback
  showing the title initial and a muted tint;
- `BookCard`;
- `SidePanel`, the transaction detail drawer;
- `Dialog`;
- `FormSection`, `Field`, `FileDrop` (wrapping the existing EPUB upload
  flow);
- `Stepper` (book form progress);
- `Chart` wrappers (line and bar, restyled Recharts, always paired with a
  table or exact values);
- `EmptyState`, `LoadingState` (skeletons), `ErrorState` (with retry),
  `NotSetUpState` (used by payouts).

For accessible behaviour, the portal uses **Radix UI primitives**: Dialog,
Popover, DropdownMenu, Tabs, Tooltip and Toggle Group. They are unstyled, so
the look stays entirely ours. Styling uses plain CSS with the tokens, in one
CSS module per component. No Tailwind.

## Pages

| Route | Content (all real data) |
| --- | --- |
| **Overview** | Net publisher earnings as the hero figure (Inter) with the period. A figure row with gross sales, units sold, refunds and commission. A Payouts block (pending and available balance) in its not-set-up state with a one-line explanation. A sales performance chart (switchable between gross and earnings) with the date range. Top books with covers. Recent activity: the latest sales and refunds from `/sales`, plus catalogue updates from the books list. Action items: drafts without a ready file, rejected uploads, books awaiting activation. |
| **Catalog** | Grid view (covers first) and table view (title, author, ISBN, status, price, copies, earnings, last updated), with search, sorting and status filters. Statuses come from real data: Draft, Processing, Ready to publish, Published, Withdrawn. The view choice is remembered. |
| **Book page** | Tabs: **Details** (metadata, cover); **Sales** (this book's sales lines); **Analytics** (this book's trend from `/summary?bookId`, see the ruling below); **Distribution** (publish and unpublish, availability, withdrawn notice); **Files & DRM** (the existing upload, version and activation panel, restyled). |
| **Add / edit book** | Sections: Book information, Classification, Commercial, Publication files, Distribution & protection. A stepper shows which sections are complete. Inline validation uses the API's field errors. "Save draft" creates or updates the draft. A publication preview shows how the book's storefront card will look, in reader-style typography. |
| **Sales & Orders** | Sales lines grouped by order (transaction id), with search, date range, book and status filters, and CSV export. A side panel opens on row click and shows the full breakdown per line: price, VAT, payment fee, commission at sale, earnings, refunds and reversals, the order's status, and timestamps. |
| **Analytics** | Trends (day, week or month), book comparison (bar plus table), country breakdown (table plus bar) and a financial analysis (commission, fees, refunds), all from the existing reports. Every chart sits next to its exact numbers. |
| **Earnings** | **Financial summary:** the reconciliation from gross down to earnings, as today with the "not yet split" and reversal lines, redesigned as a ledger-style statement. **Balances:** pending, available and paid, shown as not set up yet. **Statements:** links to the Statements page. |
| **Transactions** | The line-level ledger with search, filters, pagination, the per-line breakdown and CSV export. |
| **Payouts** | `NotSetUpState`: what payouts will show, and that earnings are recorded and safe meanwhile. No figures. |
| **Statements** | A document-style list of months (and years) for the selected range. Each row shows that month's gross and net (from `/summary` with monthly granularity) and a "Download CSV" for that month (`/sales.csv` with that month's range). PDF is marked "coming soon". |
| **Contracts** | The current contract (rate as a percentage, start date, reference, status: active, scheduled or superseded, derived from `inForce` and dates) and the history timeline. |
| **Settings** | Account (email, display name), Language, Session (sign out), and an Organization section showing what exists today. Items that aren't available yet (team, payment settings, profile) are listed as "coming later", without fake controls. |
| **Login** | Restyled with the new identity, the same behaviour. |

**Ruling for per-book analytics.** `/summary` does not take `bookId`. The
book page's Analytics tab therefore shows the book's row from `/by-book` for
the selected period, plus its sales lines. A small optional extension to let
`/summary` accept `bookId` (read-only, reusing `salesBase`, which already
supports `bookId`) is **allowed** in this project, with tests, because it is
the only way to get a per-book trend without computing it in the browser.

## Additive backend read extensions (decided after the builder check)

Existing API contracts stay unchanged. These additions are **read-only and
additive** (new fields or optional parameters, plus one new route). Each is
tested, scoped to the publisher like the existing reports, and computed on the
server. They exist so the browser never sorts, filters or sums money itself.

1. **`/publisher/reports/sales` lines gain** `itemId`, `refundedAt`,
   `commissionAtSaleCents`, `commissionReversedCents`, `earningsAtSaleCents`
   and `earningsReversedCents`.
   - They gain an optional `q` parameter: a case-insensitive match on book
     title, or a transaction-id prefix.
   - The CSV export follows the same filters.
2. **A new route, `GET /publisher/reports/orders`.** It is paginated **by
   order** (transaction): `{ orders: [{ transactionId, paidAt, lines:
   SalesLine[] }], pagination }`, with the same filters as `/sales` plus `q`.
   - It contains only the calling publisher's lines.
   - Other publishers' items and order-level refund amounts are never exposed;
     refunds are shown per line through `refundedCents` and `refundedAt`.
   - There is no "order status" roll-up. Each line shows its own status, and
     the panel lists them.
3. **`GET /publisher/books` gains:**
   - a server-derived `status`: `draft` (no ready file, not live),
     `processing` (an upload in flight), `ready` (a ready current file, not
     live), `published` or `withdrawn`;
   - `latestAsset: { state, reasonCode } | null`;
   - a `status` filter using those values;
   - `sort`: `updated`, `title`, `copies`, `earnings` or `price`, with
     `order`: `asc` or `desc`.

   Existing response fields keep their meaning.
4. **`/publisher/reports/summary` accepts `bookId`.**
5. **Contract rates gain a server-derived `status`:** `active`, `scheduled`
   or `superseded`.

## Rulings on the other open points

- **Date range:** one shared range in the TopBar, kept in the URL
  (`?from&to`). It applies to Overview, Sales & Orders, Transactions,
  Analytics and Earnings. Catalog and Contracts don't use it.
- **Statements:** these work in **whole calendar months and years** only, with
  their own month/year selector.
  - A year row is its own `/summary` call over that year with month
    granularity, and shows the backend's totals; nothing is summed in the
    browser.
  - The current month is labelled "in progress".
  - Each row's CSV covers exactly that row's period. If it exceeds the export
    cap, that row shows the translated `EXPORT_TOO_LARGE` message and offers
    the month's weeks instead.
- **Search:** the search box sends the server-side `q`; it never filters only
  the loaded page.
- **Book form sections:**
  - **Book information:** title, author, ISBN, description.
  - **Classification:** genre, language, media type.
  - **Commercial:** price in EUR.
  - **Publication files:** the EPUB upload and versions (available once the
    draft exists), plus the cover (see
    `docs/superpowers/specs/2026-11-15-cover-upload-design.md`).
  - **Distribution & protection:** read-only. It shows the publication status,
    the publish and unpublish actions, and a plain explanation that DRM is
    applied automatically.
  - **Completion rules:** Information means title and author; Classification
    means genre and language; Commercial means a price; Files means a ready
    current file; Distribution means published.
  - **Saving a draft:** the first save needs title, author, genre and price,
    and the stepper guides the publisher there. Later saves update the draft.
  - **Covers:** see `docs/superpowers/specs/2026-11-15-cover-upload-design.md`
    for the cover upload and where a book's cover comes from.
- **Recent activity:**
  - the latest sales lines;
  - recent refunds (lines with `refundedAt`, newest first);
  - "Book updated" entries from `updatedAt`.

  No other event types are inferred.
- **Settings:** account details are read only (there is no update endpoint).
  Language and sign-out are live.

## Checkpoint 1 rulings (2026-11-15, after the user's visual review)

These override anything earlier in this spec and in the plan.

- **Serif:** Instrument Serif only for the brand mark and page titles (h1,
  28 px). Hero figures, empty-state headings, dialog/panel titles, section
  headings and book titles are Inter (600 for headings). The cover
  placeholder initial in `BookCover` is cover art and may stay serif.
- **Shape, one rule:** controls (buttons, icon buttons, inputs, selects,
  segmented controls, the user button, badges) use `--radius` (6 px);
  containers (cards, tables, charts, popovers, menus, dialogs) use
  `--radius-lg` (8 px). Items nested inside a padded control use 4 px
  (6 px minus the 2 px padding). No pill shapes; only the avatar and
  decorative dots are circles.
- **Text never clips:** no `line-height: 1` on controls or truncated text;
  controls use `line-height: 1.25` (or `normal`) so descenders (g, y, q, p)
  are never cut, including native `<select>` on Windows.
- **Top bar:** no page name (the page h1 already says it). It holds the
  date range (on pages that use it) and the user button; on narrow screens
  also the menu button. The admin publisher picker moves to the top of the
  sidebar, under the brand. The language switch moves into the user menu
  (an accessible two-option group); the login page keeps its own switch.
- **Sidebar active marker:** the accent bar sits on the item's own left
  edge, not at the window edge.
- **Honest charts:** daily series are bars, never a smoothed curve (a
  smoothed spike invents sales on days without any). Any line chart uses
  linear interpolation, no `monotone`. Series colours come from the palette:
  `--accent` first, `--accent-2` second, then neutral tints; no blue.
- **Comparisons:** a "vs previous period" change is shown only when the
  previous value is non-zero. When it is zero or missing, show text instead
  ("No sales in the previous period" / "Asnjë shitje në periudhën e
  kaluar"), never a bare dash.
- **Month names** in column headers and chart axes start with a capital
  letter in both languages ("Nën 2026").
- **Not adopted:** showing the exact dates beside the range presets.

## Responsive and accessibility

- **Desktop first.**
- **Tablet** keeps the key workflows, and tables scroll horizontally.
- **Mobile** prioritises status checks and simple actions; the sidebar
  becomes a drawer.
- **WCAG 2.2 AA:**
  - full keyboard navigation and a visible focus ring (accent, 2 px);
  - labelled controls, and screen-reader-friendly tables and charts (a
    summary in text);
  - status never shown by colour alone;
  - reduced motion respected.
- **Every data view handles all seven states:** loading, empty, error,
  success, partial data, permission denied (the admin without a selected
  publisher reuses the existing ScopeGate) and stale data (a "Last updated"
  stamp, refetching on focus).

## Approaches considered

1. **Rebuild the presentation layer on the existing app (chosen).** Keep Vite,
   React, the router, TanStack Query, i18n, the API layer and the hooks, and
   replace the layout, styles and pages, adding a new `ui/` library. This
   preserves every contract and test seam.
2. **Adopt a full component kit** such as shadcn with Tailwind, or MUI.
   Faster at first, but it pulls the look toward the generic aesthetic the
   brief rejects, and it adds a styling paradigm.
3. **Start a new app from scratch.** Rejected: high regression risk, and it
   would redo the auth, scoping and i18n that already work.

## Testing

- Existing portal tests keep passing. Selectors are updated where the markup
  changes; behaviour assertions stay the same.
- New component tests:
  - `StatusBadge` has a text label;
  - `DataTable` sorts and paginates;
  - `SidePanel` traps focus and closes on Esc;
  - `DateRangePicker` presets;
  - `Figure` renders currency and period.
- Page tests:
  - each route renders real fixture data;
  - Payouts and balances show the not-set-up state and no numbers;
  - Statements' CSV link has the right month range;
  - Catalog grid and table toggle;
  - the book form stepper and validation;
  - the transaction side panel shows the backend line values unchanged.
- The i18n identical-keys test covers every new string. An automated
  accessibility check (`vitest-axe` or `@axe-core`) runs on the main pages.
- Backend suites run only if the optional `/summary?bookId` extension is made.

## Calls I made (to check)

- **Colours:** the burgundy secondary is used for emphasis and destructive
  actions. State tints (green, amber, burgundy) are derived from the PDF
  palette.
- **Styling stack:** Radix UI primitives with our own CSS, with no Tailwind
  and no component kit.
- **Fonts:** Inter plus Instrument Serif, self-hosted.
- **Two ledger pages:** Sales & Orders groups lines into orders; Transactions
  is the line-level ledger. Both use the same `/sales` data.
- **Statements:** monthly CSV statements now, PDF later.
- **Small extension allowed:** `/summary?bookId` (read-only) for per-book
  trends.
- **Columns left out:** payment method and discount columns are omitted until
  that data exists.
