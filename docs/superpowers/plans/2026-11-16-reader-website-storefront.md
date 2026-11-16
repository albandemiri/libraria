# Reader Website: Foundations, Storefront and Buying — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server-rendered reader website in `web/` with Discover, Explore (with global search),
the book page, reader sign-in and registration, and buying end to end in simulated payment mode,
plus the backend endpoints those pages need.

**Architecture:** The backend (Express 5, PostgreSQL) gains optional-auth storefront endpoints:
richer catalogue filters, facets, suggestions, publishers, a book `viewer` block, page counts and a
typed `/discover` feed. `web/` is React Router 7 in framework mode with server rendering. Its server
holds the reader's API token in an HttpOnly session cookie and calls the API with
`Authorization: Bearer`, so the browser never sees the token. Design tokens live in a shared
`design/` package that generates CSS custom properties.

**Tech Stack:** Node 24, Express 5, zod 4, PostgreSQL 15, `node:test` (backend); React 19,
React Router **7.18.5** (`react-router`, `@react-router/dev`, `@react-router/node`,
`@react-router/serve`), Vite 8, **TypeScript 6.0.3** (React Router 7.18.5 supports TypeScript only
up to 6; the portal's TS 7 must not be copied), CSS modules, Radix primitives, i18next, Vitest 5,
Testing Library, vitest-axe, Playwright 1.65 (one end-to-end test), Biome 2.

**Spec:** `docs/superpowers/specs/2026-11-16-reader-website-storefront-design.md`. Approved mockups:
`docs/superpowers/mockups/reader-website/` (Discover structure from `discover-sections.html`,
atmosphere from option **B** in `discover-masthead.html`, plus `explore.html` and `book.html`).
Read the spec before any task; the mockups are the visual reference for every web task.

## Global Constraints

- The storefront is **ebook only**: every storefront query (discover, catalogue, facets, suggestions, publishers, book detail) adds `b.media_type = 'ebook'`; checkout refuses audiobooks.
- "Owned" means an **active entitlement** (`entitlements.status = 'active'`), never a `user_libraries` row.
- Reading progress is `user_libraries.reading_progress` JSON: `{ percent?: number, chapterTitle?: string, cfi?: string }` (`percent` is what the mobile app writes).
- Transaction statuses: `pending`, `paid`, `failed`, `cancelled`, `expired` (plus refund and dispute states after payment). Checkout lives at `POST /api/v1/checkout-sessions`; the simulated provider is driven by `POST /api/v1/sandbox/transactions/:id/events` with `{ kind: 'payment_succeeded' | 'payment_failed' | 'checkout_cancelled' }`.
- Payments are **simulated mode only** for testing. Nothing in this plan may need Paddle credentials. The Paddle path is built to the documented contract and marked unverified.
- Local Docker only: no production Dockerfile, CDN or deployment work. All session-dependent HTML is `Cache-Control: private`.
- Optional auth: an absent, invalid or expired token, or a suspended account, is treated as a **guest** on public endpoints, never as an error.
- API conventions: versioned under `/api/v1`, zod-validated input, errors as `{ error: { code, message, requestId } }` via `AppError`.
- Tokens (exact): `bg #F5F2EA`, `surface #FFFEFA`, `text #25251F`, `text-secondary #6B6A62`, `text-tertiary #85847C`, `border #DEDAD0`, `accent #263D32`, `accent-2 #793E43`, `cream #F1EBDD`, `gold #D7B98A`. Spacing 4, 8, 12, 16, 24, 32, 48, 64. Radii: covers 2, chips 4, buttons and inputs 6, popovers 8.
- Fonts: Source Serif 4 (editorial) and Inter (interface), self-hosted through `@fontsource-variable/source-serif-4` and `@fontsource/inter`. No font CDN.
- Visual rules: cream page with a subtle grain; colour from covers plus **at most one dark band per page** (Discover: the green publisher spotlight). No gradients, glassmorphism, pill controls, emoji artwork, countdowns or "trending" language.
- Languages: Albanian (default) and English, through i18next. The language comes from the `libraria_lang` cookie, then `Accept-Language`, and is **not** in the URL. `<html lang>` follows it. The `sq` and `en` bundles must have identical keys.
- URLs: `/`, `/eksploro`, `/eksploro/:genre`, `/kerko?q=`, `/botues/:publisherId`, `/libri/:id/:slug?`, `/hyr`, `/regjistrohu`, `/pagesa`, `/pagesa/:transactionId`, `/biblioteka`, `/lista`, `/lexo/:id`.
- The web dev server runs on port **5174** (the portal uses 5173, and the backend's `PORTAL_ORIGIN` points there).
- Every web `action` calls `assertSameOrigin(request)` first (Task 8).
- Accessibility: keyboard reachable, visible 2px `accent` focus ring, 44×44px touch targets, `prefers-reduced-motion` respected, every page passes axe in tests.
- Samples are out of scope: no "Lexo një pjesë" button anywhere. "+ Shto në një listë" is also hidden (project 2).

## Review Focus

1. **A session that has expired or been revoked mid-visit**: the site must quietly show guest pages and drop the cookie, not an error page. Tested in Task 8.
2. **Hostile or odd query strings**: `q` containing `%` or `_`, 200+ characters, `maxPrice` below `minPrice`, an unknown `publisherId`, a page beyond the last. These must give a 400 or an empty result, never a 500, and the website must show the empty state. Tested in Tasks 1 and 15.
3. **Double-clicking "Bli librin", or going back and buying again while a payment is pending**: the same pending transaction must be reused, not a second one opened. Tested in Task 17.
4. **Books with missing data** (no cover, no description, no page count, no `publishedAt`): pages must render without "null" and without a broken image. Tested in Tasks 10 and 16.
5. **Switching language mid-browse**: the reader must stay on the same page with the same filters and query string. Tested in Task 11.

---

## File Structure

**Backend (modified or new)**

| File | Responsibility |
|---|---|
| `backend/src/middleware/auth.ts` | add `optionalAuth` |
| `backend/src/storefront/books-query.ts` (new) | shared SQL builder for storefront book lists: filters, ebook rule, `owned` flag |
| `backend/src/storefront/store-book.ts` (new) | `StoreBook` row type, column list and `toStoreBook()` mapper (moved from `routes/books.ts`) |
| `backend/src/storefront/discover.service.ts` (new) | builds the `/discover` sections |
| `backend/src/routes/books.ts` | list (new filters), `/facets`, detail with `viewer`, cover for owners |
| `backend/src/routes/search.ts` (new) | `GET /search/suggest` |
| `backend/src/routes/publishers.ts` (new) | `GET /publishers`, `GET /publishers/:id` |
| `backend/src/routes/discover.ts` (new) | `GET /discover` |
| `backend/src/app.ts` | mount `/search`, `/publishers`, `/discover` |
| `backend/src/commerce/service.ts` | refuse audiobooks |
| `backend/src/drm/epub/validate-epub.ts` | `textCharacters` in extracted metadata |
| `backend/test/integration/storefront-*.test.ts` (new) | integration tests per task |

**Design**

| File | Responsibility |
|---|---|
| `design/package.json`, `design/tsconfig.json` | private package `@libraria/design` |
| `design/src/tokens.ts` | the token values (source of truth) |
| `design/src/contrast.ts` | WCAG contrast ratio helper |
| `design/scripts/build-css.ts` | writes `design/dist/tokens.css` |
| `design/src/tokens.test.ts` | contrast and shape tests |

**Web** (`web/app/…`)

| Path | Responsibility |
|---|---|
| `root.tsx`, `routes.ts`, `entry.server.tsx` | document shell, route table, SSR entry |
| `server/env.server.ts` | zod-validated web env |
| `server/session.server.ts` | cookie session (token, user, pending checkouts) |
| `server/api.server.ts` | `apiFetch` and `ApiError` |
| `server/security.server.ts` | `assertSameOrigin` |
| `server/i18n.server.ts`, `i18n/index.ts`, `i18n/sq.json`, `i18n/en.json` | language detection and bundles |
| `lib/types.ts` | API response types shared by loaders and components |
| `lib/format.ts` | price, date, ISBN and slug formatting |
| `ui/*` | primitives (Button, Field, Checkbox, Radio, Toggle, Select, Chip, Sheet, Pagination, Breadcrumbs, ProgressBar, States, VisuallyHidden) |
| `books/*` | BookCover, BookCard (variants), PriceTag, Kicker, SectionHeader, Masthead |
| `layout/*` | SiteHeader, MobileNav, SiteFooter, LanguageSwitch, AccountMenu, ComingSoon |
| `search/*` | SearchBox, recent-searches store |
| `discover/*` | one component per section type and `DiscoverSections` |
| `explore/*` | `ExplorePage`, FiltersPanel, FilterChips, ResultsToolbar, FilterSheet, `params.ts` |
| `book/*` | BookHero, PurchaseBox, BookDetails, Synopsis, `seo.ts` |
| `checkout/*` | SimulatedPanel, PaddleCheckout, ConfirmPayment |
| `routes/*` | thin route modules (loader, action, meta, component) |
| `web/e2e/buy.spec.ts` | Playwright end-to-end buy in simulated mode |

---

## Shared API shapes (produced by Tasks 1–6, consumed by web tasks)

```ts
// StoreBook: every storefront book payload
interface StoreBook {
  id: string; title: string; author: string; isbn13: string | null; description: string | null;
  genre: string; language: string; price: { amountCents: number; currency: string };
  coverImageUrl: string | null; publishedAt: string | null;
  publisher: { id: string; name: string };
  forSale: boolean;            // publisher has a commission rate in force
  owned?: boolean;             // present only for signed-in callers
}
interface PublisherSummary {
  id: string; name: string; country: string | null;
  bookCount: number; genres: string[]; newestYear: number | null;
}
type Availability = 'on_sale' | 'not_for_sale' | 'archived' | 'taken_down';
interface BookDetail extends StoreBook { pageCount: number | null; availability: Availability }
interface Viewer {
  owned: boolean; acquiredAt: string | null;
  progress: { percent: number | null; chapterTitle: string | null } | null;
  refund: { purchasedAt: string; refundedAt: string } | null; // latest refunded purchase, only when not owned
  pendingTransactionId: string | null; // a pending checkout containing this book
}
interface Facets {
  total: number;
  genres: Array<{ genre: string; bookCount: number }>;
  publishers: Array<{ id: string; name: string; bookCount: number }>;
  languages: Array<{ language: string; bookCount: number }>;
}
interface Suggestions {
  titles: StoreBook[];                                              // ≤ 5
  authors: Array<{ name: string; bookCount: number; mainGenre: string }>; // ≤ 3
  publishers: Array<{ id: string; name: string; bookCount: number }>;     // ≤ 3
}
type DiscoverSection =
  | { type: 'featured'; book: StoreBook; related: StoreBook | null }
  | { type: 'strip'; items: Array<{ label: 'new' | 'top_month' | 'genre' | 'publisher'; book: StoreBook }> }
  | { type: 'continue_reading'; items: Array<{ book: StoreBook; percent: number | null; chapterTitle: string | null; lastReadAt: string }> }
  | { type: 'new_releases'; lead: StoreBook; books: StoreBook[] }      // books: up to 4
  | { type: 'most_read'; since: string; books: StoreBook[] }           // up to 5
  | { type: 'genres'; genres: Array<{ genre: string; bookCount: number; coverBookIds: string[] }> }
  | { type: 'publisher_spotlight'; publisher: PublisherSummary; books: StoreBook[] } // up to 4
  | { type: 'interlude'; genre: string; bookCount: number; books: StoreBook[] };    // up to 5
interface DiscoverResponse {
  issue: { isoYear: number; isoWeek: number; date: string; bookCount: number; publisherCount: number };
  sections: DiscoverSection[];   // fixed order as listed; a section with no content is omitted
}
```

Web copies these into `web/app/lib/types.ts`. The backend does not export them.

---

### Task 1: Optional auth and storefront catalogue filters

**Files:**
- Modify: `backend/src/middleware/auth.ts`
- Create: `backend/src/storefront/store-book.ts`, `backend/src/storefront/books-query.ts`
- Modify: `backend/src/routes/books.ts`, `backend/src/commerce/service.ts`
- Test: `backend/test/integration/storefront-catalogue.test.ts`

**Interfaces:**
- Produces: `optionalAuth(req, res, next)`, which sets `req.auth` only for a valid Bearer token on an active account and otherwise calls `next()` with no error. It ignores the portal cookie.
- Produces: `STORE_BOOK_COLUMNS: string`, `type StoreBookRow`, `toStoreBook(row: StoreBookRow, viewerId: string | null): StoreBook`. `owned` is included only when `viewerId` is non-null; the row carries an `owned` boolean computed in SQL.
- Produces: `buildBookFilter(f: StorefrontFilters, viewerId: string | null, startIndex: number): { where: string; params: unknown[] }`, which always includes `b.is_available AND b.media_type = 'ebook'`. Also produces `ownedSql(viewerParam: string): string`, an `EXISTS` subquery on active entitlements.
- `StorefrontFilters = { genre?: string; search?: string; publisherIds?: string[]; language?: string; minPrice?: number; maxPrice?: number; publishedSince?: Date; hideOwned?: boolean }`

- [ ] **Step 1: Write the failing tests.** Use the harness (`createPublisher`, `createBook`, `createUser`, `grantBook`, `pool`). Set `media_type`, `language`, `published_at` and `genre` with direct `UPDATE`s.

```ts
describe('GET /books storefront filters', () => {
  it('never lists audiobooks', /* audiobook row absent from list and total */);
  it('filters by several publisherId values', /* ?publisherId=A&publisherId=B → only A and B books */);
  it('filters by language, price range and publishedSince', /* each narrows; combined is the intersection */);
  it('matches search against publisher name', /* ?search=<part of publisher name> finds its books */);
  it('treats % and _ in search literally', /* ?search=50% finds only "50% …" title */);
  it('rejects maxPrice below minPrice with 400 VALIDATION_FAILED');
  it('rejects a search longer than 200 characters with 400');
  it('returns an empty page, not an error, past the last page', /* page=99 → books [] and correct total */);
  it('omits owned for guests and sets owned for a signed-in owner', /* token → owned true/false per book */);
  it('treats an invalid or expired token as a guest', /* Authorization: Bearer garbage → 200, no owned field */);
  it('hideOwned removes owned books only when signed in');
});
describe('checkout', () => {
  it('refuses an audiobook with 404 NOT_FOUND', /* POST /checkout-sessions with the audiobook id */);
});
```

- [ ] **Step 2: Run and confirm they fail.** Run: `cd backend && npm run test:integration -- --test-name-pattern="storefront filters|refuses an audiobook"`. Expected: FAIL. Unknown query keys are currently ignored, so the assertions on filtered results fail.

- [ ] **Step 3: Implement.**
  - Add `optionalAuth` beside `requireAuth`. Reuse `bearerToken`, `verifyAccessToken` and `accountStatus`. Any failure (no token, bad token, missing or suspended account) leaves `req.auth` unset.
  - Move the column list, row type and mapper from `routes/books.ts` into `storefront/store-book.ts`, and drop `mediaType` and `durationSeconds` from the public storefront shape.
  - Extend `listQuerySchema`:
    - `publisherId`: a single value or an array of UUIDs, at most 20.
    - `language`: 2–3 lowercase letters.
    - `minPrice` / `maxPrice`: integer cents ≥ 0, with a refine that `maxPrice >= minPrice` when both are set.
    - `publishedSince`: `z.coerce.date()`.
    - `hideOwned`: `'true' | 'false'`.
  - Apply `optionalAuth` to the router's list and detail routes.
  - In `createCheckout`, add `AND b.media_type = 'ebook'` to the book query, so an audiobook gets the existing 404.

- [ ] **Step 4: Run tests.** Run the same command, then `npm run test:integration -- --test-name-pattern="catalogue|book sorting"` to check the existing catalogue tests still pass. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -m "feat(storefront): optional auth, ebook-only catalogue and storefront filters"`

### Task 2: Facets and search suggestions

**Files:**
- Modify: `backend/src/routes/books.ts`
- Create: `backend/src/routes/search.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/integration/storefront-search.test.ts`

**Interfaces:**
- Consumes: `buildBookFilter`, `optionalAuth`, `toStoreBook` (Task 1).
- Produces: `GET /api/v1/books/facets` (same query parameters as the list, minus `sort`, `page` and `limit`) → `Facets`. Each dimension counts with every **other** active filter applied, but not its own. For example, publisher counts ignore `publisherId` but respect `language`. `total` applies all filters.
- Produces: `GET /api/v1/search/suggest?q=` (`q` trimmed, 2–100 characters) → `Suggestions`. Titles match title or author and are ordered by title position, then sales. Authors are distinct names matching `q`, with `mainGenre` the genre that author has most books in. Publishers have at least one storefront book and match by name.

- [ ] **Step 1: Write the failing tests.**

```ts
it('facet counts ignore their own dimension', async () => {
  // 2 books publisher A (sq), 1 book publisher B (en)
  const res = await api('GET', `/books/facets?publisherId=${A}`);
  assert.equal(res.body.total, 2);
  assert.deepEqual(res.body.publishers.map((p) => p.bookCount).sort(), [1, 2]); // B still counted
  assert.deepEqual(res.body.languages, [{ language: 'sq', bookCount: 2 }]);     // language respects publisher filter
});
it('facets exclude audiobooks and unavailable books');
it('suggest groups titles, authors and publishers', /* q='han' → titles include "Zonja e Hanit…", authors include "Hana …" */);
it('suggest rejects q shorter than 2 characters with 400');
it('suggest marks owned titles for a signed-in reader');
```

- [ ] **Step 2: Run and confirm they fail.** `npm run test:integration -- --test-name-pattern="facet|suggest"`. Expected: FAIL with 404.
- [ ] **Step 3: Implement.** Declare `/facets` before `/:id`. Run the three facet queries in parallel through the pool, each built with `buildBookFilter` on the filters minus that dimension. Mount `searchRouter` at `/search`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(storefront): catalogue facets and search suggestions"`

### Task 3: Book detail with viewer, availability, page count and owner covers

**Files:**
- Modify: `backend/src/drm/epub/validate-epub.ts`, `backend/src/drm/epub/validate-epub.test.ts`
- Modify: `backend/src/routes/books.ts`
- Test: `backend/test/integration/storefront-book.test.ts`

**Interfaces:**
- Produces: `ExtractedMetadata.textCharacters: number`, the count of non-whitespace characters across the text nodes of the spine's XHTML documents.
- Produces: `GET /api/v1/books/:id` (optional auth) → `{ book: BookDetail; viewer?: Viewer }`, with `viewer` present only for signed-in callers.
  - `pageCount = Math.max(1, Math.round(textCharacters / 1800))` from the current asset's `extracted_metadata`. It is `null` when that is missing.
  - Visibility rules:
    - On sale (`is_available`, not archived, not withdrawn): visible to all. `availability` is `on_sale`, or `not_for_sale` when `for_sale` is false.
    - Archived (`archived_at` set) or taken down (`withdrawn_at` set): visible only to callers with an active entitlement, with `availability` `archived` or `taken_down`. Everyone else gets a 404.
    - Never published (not available, not archived, not withdrawn) and audiobooks: always 404.
- Produces: `GET /api/v1/books/:id/cover` (optional auth). A taken-down book's cover is served only to an owner, with `Cache-Control: private, max-age=300`. All other behaviour is unchanged.

- [ ] **Step 1: Write the failing unit test** in `validate-epub.test.ts`:

```ts
it('counts text characters across spine documents', async () => {
  const result = await validateEpub(buildEpub({ /* fixture with chapter text "Një dy tre" */ }));
  assert.ok(result.ok);
  assert.equal(result.metadata.textCharacters, 8); // "Njëdytre"
});
```

- [ ] **Step 2: Write the failing integration tests:**

```ts
it('returns pageCount from the current asset metadata', /* set extracted_metadata.textCharacters = 360000 → pageCount 200 */);
it('returns pageCount null when metadata has no textCharacters');
it('reports not_for_sale when the publisher has no rate in force');
it('archived: 404 for guests and non-owners, archived for owners');
it('taken down: 404 for non-owners, taken_down for owners; cover served only to owners');
it('never-published and audiobook books are 404 even for an owner');
it('viewer: owned with acquiredAt and progress {percent, chapterTitle}', /* reading_progress = {"percent":42,"chapterTitle":"Kapitulli 7"} */);
it('viewer: refund {purchasedAt, refundedAt} after a refund, owned false', /* buy(), then sandbox refund event */);
it('viewer: pendingTransactionId while a checkout for the book is pending');
it('no viewer key for guests');
```

- [ ] **Step 3: Run and confirm they fail.** Unit: `cd backend && npx tsx --test src/drm/epub/validate-epub.test.ts`. Integration: `npm run test:integration -- --test-name-pattern="pageCount|archived|taken down|viewer|never-published"`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - In the content-scan loop, when an item is a spine XHTML document, sum the text lengths from the parsed tree. Walk string nodes with whitespace stripped, and skip `<script>` and `<style>`.
  - The detail query selects the book without the `is_available` condition, then applies the visibility rules above in code. It also returns `archived_at`, `withdrawn_at` and `ba.extracted_metadata->>'textCharacters'` for the current asset.
  - The `viewer` is built by:
    - one entitlement lookup, giving `owned` and `acquiredAt` (`granted_at`);
    - the `user_libraries` progress;
    - the latest refunded `transaction_items` row for this user and book (its transaction's `paid_at` and the item's `refunded_at`), used only when not owned;
    - the newest `pending` transaction containing the book.
- [ ] **Step 5: Run tests.** Run the unit test, then the integration tests, then the full suites: `npm test && npm run test:integration`. Expected: PASS.
- [ ] **Step 6: Commit.** `git commit -m "feat(storefront): book viewer block, availability states, page count and owner covers"`

### Task 4: Publishers

**Files:**
- Create: `backend/src/routes/publishers.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/integration/storefront-publishers.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/v1/publishers` → `{ publishers: PublisherSummary[] }`, sorted by name. It includes only publishers with at least one storefront book; all counts use storefront books only.
  - `GET /api/v1/publishers/:id` → `{ publisher: PublisherSummary }`, or 404 when the publisher has no storefront books.
  - `genres` is ordered by count descending. `newestYear` is the year of the latest `published_at`.
- Produces: `publisherSummaries(ids?: string[]): Promise<PublisherSummary[]>`, exported for Task 5.

- [ ] **Step 1: Write the failing tests:** the list excludes a publisher whose only book is a draft; counts exclude audiobooks; an unknown or empty publisher gives 404; `genres` and `newestYear` are correct.
- [ ] **Step 2: Run and confirm they fail.** `npm run test:integration -- --test-name-pattern="publishers"`. Expected: FAIL with 404.
- [ ] **Step 3: Implement.** One grouped query over storefront books, filtered by `buildBookFilter({}, null, 1)`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(storefront): public publisher summaries"`

### Task 5: Discover feed

**Files:**
- Create: `backend/src/storefront/discover.service.ts`, `backend/src/routes/discover.ts`
- Modify: `backend/src/app.ts`
- Test: `backend/test/integration/storefront-discover.test.ts`

**Interfaces:**
- Consumes: `buildBookFilter`, `toStoreBook`, `publisherSummaries`.
- Produces: `buildDiscover(viewerId: string | null, now: Date): Promise<DiscoverResponse>` and `GET /api/v1/discover` (optional auth), which calls it with `new Date()`.
- Produces: `isoWeek(date: Date): { isoYear: number; isoWeek: number }` and `weeklyPick<T>(items: T[], now: Date): T | undefined`. `weeklyPick` returns `items[(isoYear * 53 + isoWeek) % items.length]`, with items pre-sorted by id, so the pick is stable within a week and rotates between weeks.

Section rules (copy exactly):
- `featured`: `weeklyPick` over storefront books with a cover published in the last 60 days. If there are none, use all storefront books with a cover. `related` is another book in the same genre with a cover, else the same publisher, else `null`.
- `strip`, four items with distinct books, skipping any label without a candidate:
  - `new`: the newest book that isn't the featured one;
  - `top_month`: the top of `most_read`;
  - `genre`: the first book of the interlude genre;
  - `publisher`: the first book of the spotlight publisher.
- `continue_reading`: signed in only. Up to 3 owned books with `last_read_at` set, ordered by `last_read_at` descending.
- `new_releases`: the newest 5 by `published_at`, excluding the featured book. `lead` is the first.
- `most_read`: the top 5 by **paid**, unrefunded transaction items whose transaction `paid_at` falls in the 30 days before `now`. `since` is that start date. Omit the section when there are no sales.
- `genres`: every genre with a count and the ids of its 3 newest books that have covers.
- `publisher_spotlight`: `weeklyPick` over `publisherSummaries()`, plus its 4 newest books.
- `interlude`: `weeklyPick` over genres with 5 or more books, plus its 5 newest books.
- `issue.date` is `now` as `YYYY-MM-DD`. `bookCount` and `publisherCount` count storefront books and the publishers that have them.
- Every `StoreBook` carries `owned` when signed in.

- [ ] **Step 1: Write the failing tests** (call `buildDiscover` directly with fixed dates, and the route once):

```ts
it('isoWeek matches ISO-8601 at year boundaries', () => {
  assert.deepEqual(isoWeek(new Date('2026-12-31T12:00:00Z')), { isoYear: 2026, isoWeek: 53 });
  assert.deepEqual(isoWeek(new Date('2027-01-04T12:00:00Z')), { isoYear: 2027, isoWeek: 1 });
});
it('featured is stable within a week and changes across weeks', /* same Monday vs Sunday → same id; +7 days with ≥2 candidates → may differ; assert stability only, plus rotation over a 3-candidate set across 3 weeks covers ≥2 ids */);
it('most_read counts only paid sales in the last 30 days', /* buy() now, plus an old paid sale backdated 40 days → only recent counted */);
it('continue_reading appears only for a signed-in reader with progress');
it('omits empty sections and keeps the documented order');
it('excludes audiobooks and unavailable books everywhere');
it('GET /discover marks owned books for the signed-in reader');
```

- [ ] **Step 2: Run and confirm they fail.** `npm run test:integration -- --test-name-pattern="discover|isoWeek|featured|most_read|continue_reading"`. Expected: FAIL.
- [ ] **Step 3: Implement** the service and route. Run the independent queries in parallel.
- [ ] **Step 4: Run tests.** Run them, then `npm run lint && npm run typecheck` in `backend/`. Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(storefront): automatic discover feed with weekly rotation"`

### Task 6: Design tokens package

**Files:**
- Create: `design/package.json` (name `@libraria/design`, private, `"type": "module"`, scripts `build` (tsx), `test` (vitest), `typecheck`), `design/tsconfig.json`, `design/src/tokens.ts`, `design/src/contrast.ts`, `design/scripts/build-css.ts`, `design/src/tokens.test.ts`, `design/README.md`
- Modify: root `README.md` (one row in the directory table)

**Interfaces:**
- Produces: `tokens = { color: {...}, space: [4,8,12,16,24,32,48,64], radius: { cover: 2, chip: 4, control: 6, popover: 8 }, font: { editorial, interface }, size: {...}, motion: {...} } as const`. Colour names: `bg, surface, text, textSecondary, textTertiary, border, accent, accentHover, accentPressed, accent2, cream, gold, focus, disabled, success, warning, error`.
- Produces: `contrastRatio(fg: string, bg: string): number` (WCAG 2.x relative luminance).
- Produces: `design/dist/tokens.css`, where every token is a CSS custom property: `--color-bg`, `--color-text-secondary`, `--space-4` (index-named: `--space-1` = 4px … `--space-8` = 64px), `--radius-control`, `--font-editorial`, and so on. A `[data-theme="light"]` selector exists so dark can be added later, but no dark values are shipped.

- [ ] **Step 1: Write the failing tests:**

```ts
it('text and textSecondary pass 4.5:1 on bg and surface', () => {
  for (const bg of [tokens.color.bg, tokens.color.surface])
    for (const fg of [tokens.color.text, tokens.color.textSecondary])
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
});
it('textTertiary is below 4.5:1 on bg, so it is reserved for large text', () =>
  expect(contrastRatio(tokens.color.textTertiary, tokens.color.bg)).toBeLessThan(4.5));
it('cream passes 4.5:1 on accent; error and success pass 4.5:1 on bg');
it('white passes 4.5:1 on accent, accentHover and accentPressed');
it('build-css emits a custom property for every colour token');
```

- [ ] **Step 2: Run and confirm they fail.** `cd design && npm install && npm test`. Expected: FAIL, modules missing.
- [ ] **Step 3: Implement.** Use the exact values from Global Constraints. Choose `accentHover`, `accentPressed`, `focus`, `disabled`, `success`, `warning` and `error` so that the tests pass. Document each in `design/README.md`, including the `#85847C` → `#6B6A62` rationale.
- [ ] **Step 4: Run tests.** `npm test && npm run build && grep -c -- '--color-' dist/tokens.css`. Expected: PASS, with a count equal to the number of colour tokens.
- [ ] **Step 5: Commit.** `git commit -m "feat(design): shared design tokens with contrast tests"`

### Task 7: Web app scaffold, i18n and document shell

**Files:**
- Create: `web/package.json`, `web/react-router.config.ts` (`ssr: true`), `web/vite.config.ts` (port 5174, Vitest config: jsdom, setup file), `web/tsconfig.json`, `web/biome.json` (copied from the portal's, with `includes` adjusted to `app/**`), `web/.env.example`
- Create: `web/app/root.tsx`, `web/app/routes.ts`, `web/app/entry.server.tsx` (sets `isbot`-aware streaming, as in the React Router template), `web/app/styles/global.css`, `web/app/server/env.server.ts`, `web/app/server/i18n.server.ts`, `web/app/i18n/index.ts`, `web/app/i18n/sq.json`, `web/app/i18n/en.json`, `web/app/routes/discover.tsx` (placeholder heading only), `web/app/test-setup.ts`
- Test: `web/app/i18n/i18n.test.ts`, `web/app/root.test.tsx`
- Modify: `docker-compose.yml` (add a `web` service), root `README.md` (a "Website" section)

**Interfaces:**
- Produces: `env` (zod) with `API_URL` (default `http://localhost:3000`), `SESSION_SECRET` (dev default `dev-only-web-session-secret`, refused when `NODE_ENV=production`), `PUBLIC_ORIGIN` (default `http://localhost:5174`), `PAYMENTS_MODE` (`simulated` | `paddle`, default `simulated`), `PADDLE_CLIENT_TOKEN` (optional), `PADDLE_ENVIRONMENT` (`sandbox` | `production`, default `sandbox`), `PORTAL_URL` (default `http://localhost:5173`).
- Produces: `detectLanguage(request: Request): 'sq' | 'en'`. Order: the `libraria_lang` cookie, then `Accept-Language` (any `sq*` → `sq`), then `sq`.
- Produces: a root `headers` export so every document response carries `Cache-Control: private, max-age=0`, unless a route sets its own.
- Produces: the root `loader` returns `{ lang, user: SessionUser | null }`. `Layout` renders `<html lang={lang}>`, loads the fonts, `tokens.css` and `global.css`, and initialises i18next for `lang` on both server and client, with no hydration mismatch.
- Dependencies (exact):
  - `react-router`, `@react-router/node`, `@react-router/serve`, `@react-router/dev`: `7.18.5`
  - `typescript`: `6.0.3`
  - `react` and `react-dom`: `^19.3.1`
  - `@radix-ui/react-dialog`, `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`: the versions the portal uses
  - `i18next`, `react-i18next`, `isbot`, `@fontsource/inter`, `@fontsource-variable/source-serif-4`
  - `@libraria/design`: `file:../design`
  - dev: `vitest`, `jsdom`, `@testing-library/*`, `vitest-axe`, `axe-core`, `@biomejs/biome`, `@playwright/test`: the portal's versions where it has them
- Scripts: `dev` (`react-router dev`), `build`, `start`, `typecheck` (`react-router typegen && tsc`), `lint`, `test`, `e2e`.
- Docker: a `web` service on `node:24`, mounting `./web` and `./design`, with the backend's install-on-lock-change pattern, `npm run dev -- --host 0.0.0.0`, port `5174:5174`, `API_URL=http://backend:3000`, and `depends_on: backend`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('sq and en bundles have identical keys', /* flatten both; deepEqual sorted key lists */);
it('detectLanguage prefers the cookie, then Accept-Language, then sq', () => {
  expect(detectLanguage(req({ cookie: 'libraria_lang=en' }))).toBe('en');
  expect(detectLanguage(req({ 'accept-language': 'sq-AL,en;q=0.8' }))).toBe('sq');
  expect(detectLanguage(req({ 'accept-language': 'de-DE' }))).toBe('sq');
});
it('root renders html lang from the loader', /* createRoutesStub with root loader returning lang 'en' → document.documentElement or rendered <html lang="en"> */);
```

- [ ] **Step 2: Run and confirm they fail.** `cd web && npm install && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the scaffold. Global CSS sets the `bg` colour plus the grain data URI from the mockups on `body`, the base typography, the focus ring and the reduced-motion rule.
- [ ] **Step 4: Verify.** Run `npm test && npm run typecheck && npm run lint`, then `npm run dev`. `curl -s localhost:5174 | grep -o '<html lang="sq"'` must print `<html lang="sq"`. Then `docker compose up -d web` and repeat the `curl`. Expected: PASS for all.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): React Router 7 SSR scaffold with i18n and design tokens"`

### Task 8: API client, sessions and origin check

**Files:**
- Create: `web/app/server/session.server.ts`, `web/app/server/api.server.ts`, `web/app/server/security.server.ts`, `web/app/lib/types.ts`
- Test: `web/app/server/api.server.test.ts`, `web/app/server/security.server.test.ts`

**Interfaces:**
- Produces: `getSession(request)`, `commitSession(session)`, `destroySession(session)`. They use `createCookieSessionStorage` with the cookie `libraria_session`: `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`, `maxAge` 7 days, signed with `SESSION_SECRET`. Session data: `{ token?: string; user?: SessionUser; checkouts?: Record<string /* bookId */, { transactionId: string; idempotencyKey: string }> }`.
- Produces: `type SessionUser = { id: string; email: string; displayName: string }`.
- Produces: `apiFetch<T>(request: Request, path: string, init?: { method?: string; body?: unknown; auth?: 'optional' | 'required' }): Promise<{ data: T; setCookie?: string }>`.
  - It prefixes `${API_URL}/api/v1` and forwards the session token as Bearer.
  - On a **401** from the API it retries once without a token when `auth` is `optional`, and sets `setCookie` to the destroyed session.
  - With `auth: 'required'` it throws `redirect('/hyr?returnTo=…')`, with the session destroyed.
  - Other non-2xx responses throw `ApiError { status, code, message }`.
- Produces: `assertSameOrigin(request: Request): void`, which throws a `403` `Response` when the `Origin` header is present and is not `PUBLIC_ORIGIN`, or (when `Origin` is absent) when `Referer` does not start with `PUBLIC_ORIGIN`.

- [ ] **Step 1: Write the failing tests** (mock `globalThis.fetch`):

```ts
it('sends no Authorization header for a guest');
it('sends Bearer <token> from the session');
it('on 401 with optional auth: retries as guest and returns a destroying Set-Cookie');
it('on 401 with required auth: throws a redirect to /hyr?returnTo=<path>');
it('maps an API error body to ApiError with code and status');
it('assertSameOrigin rejects a foreign Origin and accepts PUBLIC_ORIGIN');
```

- [ ] **Step 2: Run and confirm they fail.** `npm test -- api.server security.server`. Expected: FAIL.
- [ ] **Step 3: Implement.** `lib/types.ts` holds the "Shared API shapes" above, plus `Receipt` (`{ id, status, totalCents, currency, items: Array<{ bookId, title, refunded }> }`).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): server-side API client and cookie sessions"`

### Task 9: UI primitives

**Files:**
- Create: `web/app/ui/` with `Button.tsx`, `Field.tsx` (label, input, hint, error), `Checkbox.tsx`, `Radio.tsx`, `Toggle.tsx`, `Select.tsx` (a native `<select>` styled to the mockup), `Chip.tsx` (removable), `Sheet.tsx` (Radix Dialog as a bottom sheet), `Pagination.tsx`, `Breadcrumbs.tsx`, `ProgressBar.tsx`, `States.tsx` (`EmptyState`, `ErrorState`, `Skeleton`), `VisuallyHidden.tsx`, `index.ts`, plus one `.module.css` per component
- Test: `web/app/ui/ui.test.tsx`

**Interfaces:**
- Produces:
  - `Button({ variant: 'primary' | 'secondary' | 'ghost' | 'onDark', size?: 'md' | 'lg', loading?, disabled?, asChild? })`. While loading it sets `aria-busy`, keeps its width and blocks clicks.
  - `Pagination({ page, totalPages, hrefFor(page) })`, which renders links (not buttons) with `aria-current="page"`.
  - `ProgressBar({ value, label })` with `role="progressbar"` and `aria-valuenow`.
  - `Chip({ children, onRemove, removeLabel })`.
  - `Sheet({ open, onOpenChange, title, children, footer })`.
  - `Breadcrumbs({ items: Array<{ label, href? }> })`.

- [ ] **Step 1: Write the failing tests:** every component passes axe; Button's loading state blocks clicks and sets `aria-busy`; Pagination marks the current page and hides "Para" on page 1 and "Pas" on the last page; Chip's remove control has an accessible name; ProgressBar exposes its value; Sheet traps focus and closes on Escape.
- [ ] **Step 2: Run and confirm they fail.** `npm test -- ui.test`. Expected: FAIL.
- [ ] **Step 3: Implement** to the mockups. Interactive targets are at least 44px tall on touch (`@media (pointer: coarse)`).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): accessible UI primitives"`

### Task 10: Book components and the cover proxy

**Files:**
- Create: `web/app/books/BookCover.tsx`, `BookCard.tsx`, `PriceTag.tsx`, `Kicker.tsx`, `SectionHeader.tsx`, `Masthead.tsx`, plus CSS modules; `web/app/lib/format.ts`; `web/app/routes/cover.ts` (resource route `GET /kopertina/:id`)
- Test: `web/app/books/books.test.tsx`, `web/app/lib/format.test.ts`, `web/app/routes/cover.test.ts`

**Interfaces:**
- Produces: `coverSrc(book: { id: string; coverImageUrl: string | null }, size?: 'thumb'): string | null` → `/kopertina/:id?v=…&size=thumb`. It keeps the API's `v` cache-buster.
- Produces: `BookCover({ book, size?: 'thumb' | 'full', priority?: boolean, alt?: string })`.
  - It renders `<img>` at 2:3 with explicit `width` and `height`, and `loading="lazy"` unless `priority`.
  - With no cover URL, or on an image `onError`, it renders a typographic fallback: title and author in serif on `surface` with a `border`. Never a broken image.
- Produces: `BookCard({ book, variant: 'grid' | 'list' | 'ranked' | 'lead' | 'compact', rank?: number, showPublisher?: boolean, showGenre?: boolean })`. It links to `/libri/:id/:slug`. The card's information differs by variant, as the spec asks.
- Produces: `PriceTag({ book })`, which shows the formatted price, "✓ Në bibliotekën tënde" when `owned`, or "Përkohësisht nuk shitet" when `!forSale`.
- Produces in `format.ts`:
  - `formatPrice(cents, currency, lang)`, giving `5,99 €` in sq and `€5.99` in en;
  - `formatDate(iso, lang, style: 'day' | 'month')`;
  - `formatIsbn13(isbn)`, giving `978-0-00-000009-5`;
  - `slugify(title)`, which strips diacritics (`ë` → `e`, `ç` → `c`), lowercases and hyphenates;
  - `bookHref(book)`.
- Produces: the `/kopertina/:id` route, which streams `GET {API_URL}/api/v1/books/:id/cover` (passing `size`, `v` and the session Bearer) and copies `Content-Type` and `Cache-Control` from the API.

- [ ] **Step 1: Write the failing tests:**

```ts
expect(formatPrice(599, 'EUR', 'sq')).toBe('5,99 €');
expect(formatIsbn13('9780000000095')).toBe('978-0-00-000009-5');
expect(slugify('Zonja e Hanit të Bardhë')).toBe('zonja-e-hanit-te-bardhe');
it('BookCover renders the typographic fallback when coverImageUrl is null');
it('BookCover swaps to the fallback when the image errors');
it('BookCard never prints "null" for a missing description or publishedAt');
it('PriceTag shows owned and temporarily-unavailable states');
it('cover route forwards the session token and copies Cache-Control');
```

- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** to the mockups (covers use the small two-layer shadow; `ranked` uses the italic numeral in `accent-2`).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): book components, formatting and cover proxy"`

### Task 11: Site shell, language switch and coming-soon pages

**Files:**
- Create: `web/app/layout/SiteHeader.tsx`, `MobileNav.tsx`, `SiteFooter.tsx`, `LanguageSwitch.tsx`, `AccountMenu.tsx`, `ComingSoon.tsx`, plus CSS modules; `web/app/routes/language.ts` (action `POST /gjuha`); `web/app/routes/coming-soon.tsx` (used by `/biblioteka`, `/lista`, `/lexo/:id`)
- Modify: `web/app/root.tsx` (render the shell around `<Outlet/>`), `web/app/routes.ts`
- Test: `web/app/layout/layout.test.tsx`, `web/app/routes/language.test.ts`

**Interfaces:**
- Consumes: the root loader's `{ lang, user }`.
- Produces:
  - **SiteHeader:** wordmark, then nav (Zbulo, Eksploro, Biblioteka ime, Listat e leximit) with `aria-current` on the active item, a slot for `SearchBox` (Task 12), `LanguageSwitch`, and `AccountMenu` (the name and "Dil" when signed in, else "Hyr").
  - **MobileNav:** a fixed bottom bar below 768px with the same four destinations. The header then shows the wordmark and a search button.
  - **SiteFooter:** columns as in the mockup.
- Produces: `POST /gjuha` with `{ lang, returnTo }`. It runs `assertSameOrigin`, sets the `libraria_lang` cookie (1 year, `sameSite: 'lax'`), and redirects to `returnTo`. `returnTo` must be a same-site path starting with `/`, otherwise it falls back to `/`.
- Produces: `ComingSoon({ kind: 'library' | 'lists' | 'reader' })`, which explains the feature is coming and that books are readable in the Libraria app today.

- [ ] **Step 1: Write the failing tests:**

```ts
it('language switch keeps the path and query string', /* POST /gjuha {lang:'en', returnTo:'/eksploro/Fiction?sort=title&page=2'} → 302 Location same, Set-Cookie libraria_lang=en */);
it('language switch refuses an absolute returnTo', /* returnTo 'https://evil.example' → Location '/' */);
it('header marks the active destination with aria-current');
it('account menu shows Hyr for guests and the name plus Dil for readers');
it('mobile nav renders the four destinations with accessible labels');
it('coming-soon pages pass axe');
```

- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.** LanguageSwitch is a `<Form method="post" action="/gjuha">` whose `returnTo` is `location.pathname + location.search`, so it works without JavaScript.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): site shell, language switch and coming-soon pages"`

### Task 12: Sign-in and registration

**Files:**
- Create: `web/app/routes/sign-in.tsx` (`/hyr`), `web/app/routes/register.tsx` (`/regjistrohu`), `web/app/routes/sign-out.ts` (action `POST /dil`), `web/app/auth/AuthForm.module.css`, `web/app/lib/return-to.ts`
- Test: `web/app/routes/auth.test.tsx`, `web/app/lib/return-to.test.ts`

**Interfaces:**
- Consumes: `apiFetch`, the session, `assertSameOrigin`.
- Produces: `safeReturnTo(value: string | null): string`. It accepts a path starting with a single `/`, without `//` or `\`; anything else gives `/`.
- Sign-in action: calls `POST /auth/login` with `{ email, password }`.
  - If the user's role is not `reader`, it shows "Ky është një llogari botuesi. Përdor portalin e botuesve." with a link to `env.PORTAL_URL` and stores nothing.
  - Otherwise it stores `token` and `user` in the session and redirects to `safeReturnTo(returnTo)`.
- Register action: calls `POST /auth/register` with `{ email, password, displayName }`, then behaves the same. Field errors from the API's validation details are shown inline. Inputs keep their values after an error.
- Sign-out action: destroys the session and redirects to `/`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('sign-in stores the session and redirects to a safe returnTo');
it('sign-in refuses publisher and admin accounts with the portal message');
it('wrong password shows a form error and keeps the email');
it('safeReturnTo rejects //evil.example, https://evil.example and \\\\evil');
it('register shows API field errors next to their fields');
it('sign-in and register pages pass axe');
```

- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** to the masthead style (big serif heading, a narrow form on `surface`).
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): reader sign-in, registration and sign-out"`

### Task 13: Global search

**Files:**
- Create: `web/app/search/SearchBox.tsx`, `SearchBox.module.css`, `recent-searches.ts`; `web/app/routes/suggest.ts` (resource route `GET /kerko/sugjerime?q=`)
- Modify: `web/app/layout/SiteHeader.tsx` (mount `SearchBox`)
- Test: `web/app/search/search.test.tsx`

**Interfaces:**
- Consumes: `apiFetch` to `GET /search/suggest`; `BookCover`.
- Produces: the `/kerko/sugjerime` route, which returns `Suggestions` JSON and returns empty groups for `q` under 2 characters without calling the API.
- Produces: `SearchBox`, an ARIA 1.2 combobox (`role="combobox"`, `aria-expanded`, `aria-activedescendant`, `role="listbox"` and `role="option"`).
  - It fetches through `useFetcher` 200ms after the last keystroke, only when the input has at least 2 characters.
  - Groups: Tituj, Autorë, Botues, Kërkimet e fundit. The matched substring is wrapped in `<mark>`.
  - ↑ and ↓ move between options, Enter opens the active option, and Enter with no active option goes to `/kerko?q=`. Escape closes.
  - The footer row reads "Shiko të gjitha rezultatet për "q"".
  - It is a `<form action="/kerko">`, so it works without JavaScript.
  - An author option goes to `/kerko?q=<name>`, and a publisher option to `/botues/:id`.
- Produces: `recentSearches.read(): string[]`, `.add(q)` and `.remove(q)`. They use `localStorage` key `libraria.recentSearches`, keep at most 5 entries, try/catch every access, and fall back to `[]`.

- [ ] **Step 1: Write the failing tests:** no request below 2 characters; debounced to one request after quick typing; arrow keys move `aria-activedescendant`; Enter without an active option navigates to `/kerko?q=han`; Escape closes and returns focus; `<mark>` highlights the match; a `localStorage` that throws does not break rendering; the open listbox passes axe.
- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** to the mockup's dropdown.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): global search with suggestions"`

### Task 14: Discover page

**Files:**
- Create: `web/app/discover/` with `IssueLine.tsx`, `FeaturedMasthead.tsx`, `Strip.tsx`, `ContinueReading.tsx`, `NewReleases.tsx`, `MostRead.tsx`, `GenreTiles.tsx`, `PublisherSpotlight.tsx`, `Interlude.tsx`, `DiscoverSections.tsx`, plus CSS modules
- Modify: `web/app/routes/discover.tsx`
- Test: `web/app/discover/discover.test.tsx`

**Interfaces:**
- Consumes: `DiscoverResponse` via `apiFetch(request, '/discover', { auth: 'optional' })`; `BookCard`, `BookCover`, `Kicker`, `SectionHeader`, `Masthead`, `PriceTag`, `ProgressBar`.
- Produces: `DiscoverSections({ sections })`. It renders sections in order, renders `most_read` and `genres` side by side when they are adjacent (stacked on phones), and **skips unknown types** without throwing.
- Produces: the loader returns `{ discover, lang }`, and `meta` sets the title "Libraria — Zbulo" or "Libraria — Discover" plus the description and `og:*` tags.
- The FeaturedMasthead shows:
  - the title at display size, with the last word in italic `accent-2`;
  - the description as the lede;
  - author, publisher and price;
  - "Bli librin", or "Lexo tani" (to `/lexo/:id`) when owned;
  - the cover with the overlapping `related` cover and its caption.
- The "Bli librin" button posts to the book page's `buy` action (Task 17) with `returnTo=/`.
- `PublisherSpotlight` is the **only** dark (`accent`) band. Genre names display through i18n keys `genres.<Genre>` (Fiction → Prozë, History → Histori, Poetry → Poezi, Essays → Ese, Children → Për fëmijë), falling back to the raw value.

- [ ] **Step 1: Write the failing tests:**

```ts
it('renders sections in the order received');
it('skips an unknown section type without crashing', /* sections: [{type:'collection', …}, featured] → featured renders */);
it('shows Lexo tani instead of Bli librin when the featured book is owned');
it('hides Vazhdo leximin when the section is absent');
it('translates genre names and falls back to the raw genre');
it('the full page with every section passes axe');
```

- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** to `discover-sections.html`, with the masthead and issue line from option B in `discover-masthead.html`.
- [ ] **Step 4: Verify.** Run `npm test`. Then, with Docker up and `seed:demo` loaded, open `http://localhost:5174/` at 1280px and at 390px, and compare against the mockups. Expected: tests PASS, and the page matches the mockups.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): discover page"`

### Task 15: Explore, search results and publisher catalogue

**Files:**
- Create: `web/app/explore/ExplorePage.tsx`, `FiltersPanel.tsx`, `FilterChips.tsx`, `ResultsToolbar.tsx`, `FilterSheet.tsx`, `params.ts`, plus CSS modules
- Create: `web/app/routes/explore.tsx` (`/eksploro` and `/eksploro/:genre`), `web/app/routes/search.tsx` (`/kerko`), `web/app/routes/publisher.tsx` (`/botues/:publisherId`)
- Test: `web/app/explore/params.test.ts`, `web/app/explore/explore.test.tsx`

**Interfaces:**
- Consumes: `GET /books`, `GET /books/facets`, `GET /publishers/:id`, `GET /books/genres`; the UI primitives; `BookCard`.
- Produces: `parseExploreParams(url: URL, routeParams): ExploreState` and `toApiQuery(state): URLSearchParams`, which round-trip.
  - `ExploreState = { genre?, q?, publisherIds: string[], language?, maxPrice?, since?: '30d' | 'year', hideOwned: boolean, sort: 'new' | 'top' | 'title' | 'price_asc' | 'price_desc', view: 'grid' | 'list', page: number }`.
  - Invalid values are dropped, not passed to the API. `page` is at least 1, and `since` becomes `publishedSince` (today minus 30 days, or 1 January this year).
- Produces: a loader that fetches books, facets and (for a publisher) the summary in parallel. It returns `{ state, books, pagination, facets, publisher?, title, description }`.
- `ExplorePage({ mode: 'all' | 'genre' | 'search' | 'publisher' })`:
  - breadcrumbs, the masthead title and an italic count line;
  - genre descriptions from i18n `genreIntro.<Genre>` (`all` and `search` have none);
  - the genre bar;
  - desktop sidebar filters, auto-submitting a GET `<Form>` with `useSubmit` on change, and working with JavaScript off via an "Apliko" button inside `<noscript>`;
  - chips with per-filter removal links, plus "Pastro të gjitha";
  - the sort `<select>` and the grid/list switch as links;
  - a 4-column grid, or list rows;
  - `Pagination`;
  - on screens narrower than 768px, a "Filtrat · N" button opens `FilterSheet`, whose submit button reads "Shfaq {total} libra" (the total re-fetched from facets through a fetcher as the options change);
  - "Fshih librat që i kam" shows only when signed in.
- Empty results show `EmptyState` with "Pastro filtrat". An API 400 shows the empty state (the parameters were already sanitised; this is a safety net).
- `meta`: the page title per mode, and a canonical URL without `view` or `page=1`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('parse → toApiQuery round-trips a full state');
it('drops junk: page=-3, sort=evil, maxPrice=abc, publisherId=not-a-uuid');
it('since=year maps to publishedSince = Jan 1 of the current year');
it('a q of 250 characters is truncated to 200 before reaching the API');
it('removing one chip keeps every other filter in the link');
it('shows the empty state with Pastro filtrat when total is 0');
it('hides the hide-owned toggle for guests');
it('publisher mode titles the page with the publisher name');
it('explore page passes axe in grid and list views');
```

- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** to `explore.html`.
- [ ] **Step 4: Verify.** Run `npm test`, then manually check `/eksploro/Fiction?publisherId=…&sort=title` at 1280px and 390px against the mockup. Expected: PASS, and it matches.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): explore, search results and publisher catalogue"`

### Task 16: Book page

**Files:**
- Create: `web/app/book/BookHero.tsx`, `PurchaseBox.tsx`, `BookDetails.tsx`, `Synopsis.tsx`, `seo.ts`, plus CSS modules
- Create: `web/app/routes/book.tsx` (`/libri/:id/:slug?`)
- Test: `web/app/book/book.test.tsx`, `web/app/book/seo.test.ts`

**Interfaces:**
- Consumes:
  - `GET /books/:id` → `{ book: BookDetail; viewer?: Viewer }`;
  - `GET /books?publisherId=…&limit=7`, for the same-publisher shelf;
  - `GET /books?genre=…&limit=7`, for the similar shelf;
  - `GET /books?search=<author>&limit=7`, for "more by the author", rendered only when at least 2 books have exactly that author.
  - Each shelf drops the current book and shows up to 6.
- The loader redirects `301` to the canonical `/libri/:id/:slug` when the slug is missing or wrong. A 404 from the API renders a styled not-found page with status 404.
- Produces: `purchaseState(book: BookDetail, viewer?: Viewer): PurchaseState`, where `PurchaseState` is `'guest_can_buy' | 'can_buy' | 'pending' | 'owned' | 'owned_taken_down' | 'not_for_sale' | 'refunded'`. Precedence:
  1. `taken_down` + owned → `owned_taken_down`;
  2. owned → `owned`;
  3. `pendingTransactionId` → `pending`;
  4. `!forSale`, or availability not `on_sale` → `not_for_sale`;
  5. `refund` set → `refunded`;
  6. signed in → `can_buy`;
  7. otherwise `guest_can_buy`.
- `PurchaseBox` copy per state (exact):
  - `can_buy`: the price, "TVSH e përfshirë", and "Bli librin".
  - `guest_can_buy`: the same; the button links to `/hyr?returnTo=/libri/:id/:slug`.
  - `owned`: "✓ Në bibliotekën tënde që nga {date}", plus the progress bar with "{percent}% · {chapterTitle}" when there is progress, then "Vazhdo leximin" (or "Lexo tani" with no progress) to `/lexo/:id`.
  - `owned_taken_down`: "Ky libër është hequr nga botuesi dhe nuk mund të lexohet më".
  - `not_for_sale`: "Përkohësisht nuk shitet".
  - `refunded`: "Ke blerë këtë libër më {purchasedAt} dhe u rimbursove më {refundedAt}." with "Bli përsëri".
  - `pending`: "Pagesa po përpunohet" with a link to `/pagesa/:transactionId`.
- The buy button is a `<Form method="post">` with `intent=buy` (handled in Task 17). Under the box: "Lexoje kudo. Në shfletues dhe në aplikacionin Libraria për iOS dhe Android, edhe pa internet."
- `BookDetails`: publisher (a link to `/botues/:id`), published date, language name, "rreth {pageCount} faqe", "EPUB · e mbrojtur", and the hyphenated ISBN. A row is omitted when its value is null.
- `Synopsis`: "Rreth librit"; the description split into paragraphs on blank lines; a drop cap on the first paragraph; genre tags. With no description the section is omitted.
- Produces: `bookMeta(book, origin, lang)` → React Router `MetaDescriptor[]`. It covers the title, description (the first 160 characters), the canonical URL, `og:type=book`, `og:image` (the absolute cover URL), `twitter:card=summary_large_image`, and `schema.org/Book` JSON-LD (`name`, `author`, `isbn`, `inLanguage`, `publisher`, `image`, plus an `offers` `Offer` with the price, `priceCurrency` and `availability` InStock only when `on_sale`).
- The phone layout pins the price and the main button to the bottom.

- [ ] **Step 1: Write the failing tests:**

```ts
it.each([
  [{ availability: 'taken_down' }, { owned: true }, 'owned_taken_down'],
  [{}, { owned: true }, 'owned'],
  [{}, { owned: false, pendingTransactionId: 't1' }, 'pending'],
  [{ forSale: false }, { owned: false }, 'not_for_sale'],
  [{}, { owned: false, refund: { purchasedAt: '2026-09-03', refundedAt: '2026-09-05' } }, 'refunded'],
  [{}, { owned: false }, 'can_buy'],
  [{}, undefined, 'guest_can_buy'],
])('purchaseState %#', /* … */);
it('redirects a wrong slug to the canonical URL with 301');
it('renders without description, cover, pageCount or publishedAt and never prints null');
it('JSON-LD has an Offer only when on sale');
it('more-by-author shelf hidden when the author has one book');
it('book page passes axe in can_buy and owned states');
```

- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement** to `book.html`.
- [ ] **Step 4: Verify.** Run `npm test`, then `curl -s localhost:5174/libri/<demo id> | grep -c 'application/ld+json'`. Expected: PASS, and the count is 1.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): book page with purchase states and SEO"`

### Task 17: Buying end to end

**Files:**
- Modify: `web/app/routes/book.tsx` (`action` with `intent=buy`)
- Create: `web/app/routes/checkout-start.tsx` (`/pagesa`, the Paddle default payment link page), `web/app/routes/checkout-status.tsx` (`/pagesa/:transactionId`), `web/app/routes/transaction-status.ts` (resource route `GET /pagesa/:transactionId/status`), `web/app/checkout/SimulatedPanel.tsx`, `PaddleCheckout.tsx`, `ConfirmPayment.tsx`, plus CSS modules
- Create: `web/e2e/buy.spec.ts`, `web/playwright.config.ts`
- Test: `web/app/checkout/checkout.test.tsx`

**Interfaces:**
- Consumes: `POST /checkout-sessions`, `GET /transactions/:id`, `POST /sandbox/transactions/:id/events`, the session's `checkouts` map, and `assertSameOrigin`.
- **Buy action:**
  1. Run `assertSameOrigin`, then require sign-in (redirect to `/hyr?returnTo=<book path>`).
  2. Reuse `session.checkouts[bookId]` when it exists and the transaction is still `pending`; otherwise create a new `idempotencyKey` (`crypto.randomUUID()`) and store it.
  3. `POST /checkout-sessions` with `{ bookIds: [bookId], idempotencyKey }`.
  4. Responses:
     - `ALREADY_OWNED` (409): redirect to the book.
     - `BOOK_NOT_FOR_SALE` or `NOT_FOUND`: return a form error shown in the PurchaseBox.
     - `PAYMENTS_UNAVAILABLE` (503): show "Blerjet nuk janë ende të disponueshme".
     - Success with `checkout.url` set (Paddle): redirect there.
     - Success with no URL (simulated): redirect to `/pagesa/:transactionId`.
- **`/pagesa/:transactionId`:**
  - The loader requires sign-in and returns the receipt.
  - While the status is `pending` and `PAYMENTS_MODE=simulated`, it shows `SimulatedPanel`: a box labelled "Mjedis zhvillimi · pagesë e simuluar" with "Paguaj", "Dështo" and "Anulo". Each is a form post to this route's action, which calls the sandbox endpoint with `payment_succeeded`, `payment_failed` or `checkout_cancelled` and then redirects back to the page.
  - `ConfirmPayment` polls `/pagesa/:id/status` with `useFetcher` (at 1, 2, 3 and 5 seconds, then every 5 seconds, up to 60 seconds in total) while the status is `pending`.
  - Final states:
    - `paid`: "Libri është në bibliotekën tënde" with the cover and a link to the book. The session's `checkouts[bookId]` is removed.
    - `failed`, `cancelled` or `expired`: an explanation plus "Provo përsëri" (back to the book).
    - Still pending after 60 seconds: "Pagesa po përpunohet; do ta shohësh librin në bibliotekë sapo të konfirmohet."
  - Only the API decides ownership; the page never grants anything.
- **`/pagesa` (Paddle landing):** loads `https://cdn.paddle.com/paddle/v2/paddle.js`, initialises it with `PADDLE_CLIENT_TOKEN` and `PADDLE_ENVIRONMENT`, and opens the overlay for the `_ptxn` query parameter. On `checkout.completed` it navigates to `/pagesa/<our transaction id>`, using the id the session stored for that checkout. Without a client token it shows an error state. Mark it `// UNVERIFIED: no Paddle sandbox account yet (spec §6).` The page's CSP allows Paddle's script and frame origins, and nothing else extra.
- **E2E (`web/e2e/buy.spec.ts`):** needs Docker up with `seed:demo` loaded.
  1. Register a fresh reader (unique email).
  2. Open a book page from `/eksploro`.
  3. Click "Bli librin" twice quickly; only one transaction is created (assert via the API).
  4. On `/pagesa/:id`, click "Paguaj".
  5. Expect "Libri është në bibliotekën tënde".
  6. Open the book: "Lexo tani" is visible.
  7. Buy another book, click "Anulo", and expect "Provo përsëri".

- [ ] **Step 1: Write the failing component and action tests** (with `apiFetch` mocked):

```ts
it('buy reuses the stored idempotency key while the transaction is pending');
it('buy redirects a guest to /hyr with returnTo');
it('buy redirects to /pagesa/:id when checkout.url is null');
it('buy shows the unavailable message on PAYMENTS_UNAVAILABLE');
it('status page stops polling on paid and clears the stored checkout');
it('status page shows the still-processing message after 60 seconds', /* fake timers */);
it('simulated panel is absent when PAYMENTS_MODE is paddle');
```

- [ ] **Step 2: Run and confirm they fail.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests.** `npm test`, then `docker compose up -d && docker compose exec backend npm run seed:demo` (skip if already loaded), then `cd web && npx playwright install chromium && npm run e2e`. Expected: all PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat(web): buying end to end with simulated payments"`

### Task 18: Documentation and full verification

**Files:**
- Modify: root `README.md`:
  - a "Website" section: start it, the env values, the URLs, signing in with a demo reader, buying in simulated mode, and the e2e command;
  - the new storefront endpoints in the API section.
- Modify: `web/README.md` (create it if absent; a short version of the above).

- [ ] **Step 1: Write the docs** from what was built, including the explicit statement that the Paddle path is unverified until a sandbox account exists.
- [ ] **Step 2: Run everything.**
  - In `backend/`: `npm run lint && npm run typecheck && npm test && npm run test:integration`
  - In `design/`: `npm test`
  - In `web/`: `npm run lint && npm run typecheck && npm test && npm run build && npm run e2e`
  - In `portal/`: `npm test` (regression check).

  Expected: all PASS.
- [ ] **Step 3: Commit.** `git commit -m "docs: reader website and storefront API"`
