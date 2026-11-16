# Reader website, project 1: foundations, storefront and buying

**Date:** 2026-11-16
**Status:** design; approach approved, builder review done; awaiting the owner's approval of this document
**Governing documents:** *Libraria Reader UI/UX Design Guidelines* (the PDF the project owner
supplied, referred to below as "the guidelines") and the *Technical Architecture Specification
v2.1*.
**Mockups:** `docs/superpowers/mockups/reader-website/` (open the HTML files in a browser while
the local API runs on `:3000` with `npm run seed:demo` loaded; they load real demo covers).

## 1. Why

Libraria needs a reader-facing website. Readers can buy and read books either on the website or
in the mobile apps; the two are equal. **The website is designed first, and the mobile apps will
later follow its design.** The guidelines describe the product: "a digital home for literature",
closer to an independent bookstore and a literary journal than a technology dashboard.

The whole reader website is several projects, built in this order, each with its own design and
plan:

1. **Foundations and storefront, with buying** (this document).
2. Library and reading lists (needs reading status and collections in the backend).
3. Web reader (foliate-js and in-browser decryption, from
   `2026-11-16-reader-engine-trial-findings.md`).
4. Checkout polish and account pages.

## 2. Goals, non-goals, anti-goals

**Goals**

- A new app in `web/` with the design foundations, the core component library, the site shell,
  reader sign-in and registration, and three pages: **Discover**, **Explore** (including global
  search) and the **book page**.
- **Buying works end to end:** "Bli librin" starts a real checkout through the existing commerce
  backend, and the book shows as owned once payment is confirmed.
- Design tokens in a shared `design/` package, so the mobile app can adopt the same palette,
  type and spacing later.
- Albanian and English from day one, Albanian by default.
- Server-rendered storefront pages, so book pages are indexable and shared links preview with
  title, cover and description.

**Non-goals (later projects or later work)**

- Library page, reading status, reading lists (project 2).
- Reading in the browser (project 3). Until then, "Vazhdo leximin" / "Lexo tani" link to a
  "coming soon" page that names the mobile app as the way to read today.
- Account pages, purchase history page, refunds UI, devices (project 4).
- Samples / "Lexo një pjesë" (the button is hidden until samples exist).
- Dark theme (tokens are structured for it; no dark values shipped).
- Author pages and author features (no author data beyond a name).
- Editorial curation tooling (see 5.1: the Discover feed is automatic now and can take curated
  sections later without frontend changes).
- Reviews (not supported by the product; the guidelines say to omit them).
- **Audiobooks.** They come much later, after launch. Every storefront query (discover,
  catalogue, search, suggestions, facets, publisher counts) returns `media_type = 'ebook'`
  only, and checkout refuses audiobooks.
- **Production deployment.** Libraria runs locally until publisher contracts are signed and the
  site is ready to go live. Project 1 runs in local Docker only; no production Dockerfile, CDN,
  domain or deployment work.
- **A verified Paddle purchase.** There is no Paddle sandbox account yet (see 6).

**Anti-goals (would make this a failure even if it works)**

- The generic "AI interface" look the guidelines warn against: gradients, glassmorphism, pill
  controls everywhere, shadows on every surface, emoji as artwork, identical cards on every page.
- Engagement manipulation: endless feeds, countdowns, "🔥 trending", artificial urgency.
- A plain, flat page. The project owner judged the first plain mockup "not catchy"; the approved
  direction (section 4) is deliberately richer.
- Colour overload. The owner rejected a page of alternating coloured bands as "too much".
- Removing or hiding a book a reader owns because it is withdrawn from sale.

## 3. Approaches considered

| Approach | Trade-off | Decision |
|---|---|---|
| **A. React Router 7 framework mode with server rendering** | Storefront pages are real HTML (indexable, link previews). Same router library and tooling family as the portal. Needs a small Node server alongside the API. | **Chosen** by the project owner. |
| B. Vite single-page app, like the portal | Simplest to build and host. Book pages invisible to search engines and link previews without adding pre-rendering. A real cost for a bookstore. | Rejected. |
| C. Next.js | Server rendering as good as A, but a second framework and routing model in the repo, for nothing A lacks. | Rejected. |
| Adding reader pages to the portal | Different audience, look and login (portal uses a publisher/admin cookie session). | Ruled out. |

For the Discover page the owner also chose between an **automatic feed now with curated sections
later** (chosen) and building a curation tool in the admin console first (rejected: it delays the
storefront for content nobody is ready to write).

## 4. Visual direction (decided)

The owner reviewed mockups and chose:

- **Discover layout "A, editorial lead"** (one large featured book, then calm sections down the
  page), **enriched** with the sections in `discover-sections.html`.
- **Atmosphere "B, magazine masthead"** (`discover-masthead.html`, option B): very large serif
  headlines, an issue line, a faint paper grain on the cream background, covers overlapping like
  a magazine spread.
- **Colour:** the page stays on cream. Colour comes from the covers, plus **one** deep moment per
  page at most: on Discover, the dark green publisher spotlight band. No alternating coloured
  bands, and **no** cover-coloured hero (the masthead replaces it).
- **Explore** (`explore.html`) and the **book page** (`book.html`) approved without changes.

### 4.1 Tokens

From the guidelines' approved palette, with one accessibility adjustment:

| Token | Value | Use |
|---|---|---|
| `bg` | `#F5F2EA` | Page background (with the grain overlay, see below) |
| `surface` | `#FFFEFA` | Inputs, cards, popovers, sheets |
| `text` | `#25251F` | Headings, body, important labels |
| `text-secondary` | `#6B6A62` | Metadata and small text. **Darkened** from the guidelines' `#85847C`, which is below 4.5:1 on `bg` for small text; the guidelines ask for exactly this check. |
| `text-tertiary` | `#85847C` | Placeholders and large, non-essential text only |
| `border` | `#DEDAD0` | Dividers, outlines |
| `accent` | `#263D32` | Primary actions, active navigation, selected states, the spotlight band |
| `accent-2` | `#793E43` | Kickers, ranking numerals, drop caps, sparing emphasis |
| `cream` / `gold` | `#F1EBDD` / `#D7B98A` | Text and kickers on the dark spotlight band only |

The builder defines separate hover, pressed, focus, disabled, success, warning and error tokens
and checks contrast for every real foreground/background pair.

- **Grain:** an SVG `feTurbulence` noise tile at about 7% opacity over `bg` (the exact data URI is
  in the mockups). It must stay subtle: paper, not parchment.
- **Type:** Source Serif 4 (editorial: titles, book titles, headings, ledes, numerals) and Inter
  (interface: navigation, buttons, controls, metadata). Self-hosted via `@fontsource`, as the
  portal does; no font CDN. Large display sizes (around 80–110 px on desktop) for page mastheads;
  interface text 14–16 px; body line height 1.5–1.7.
- **Spacing and shape:** 4 px base; scale 4, 8, 12, 16, 24, 32, 48, 64. Radii 2 px on covers, 4 px
  on chips, 6 px on buttons and inputs, 8 px on popovers. Thin borders; shadows only on covers
  and floating layers. Max content width about 1280 px with 48 px side padding on desktop.
- **Covers:** 2:3, a small two-layer shadow, never cropped decoratively. Large hero covers get a
  deeper shadow.

`design/` holds tokens as the source of truth (for example a TypeScript or JSON module) and
generates CSS custom properties for `web/`. A React Native theme export is not built now, but the
format must make it straightforward.

## 5. Pages

All copy below is from the Albanian mockups; English strings come from i18n.

### 5.1 Discover (`/`)

Top to bottom, as approved:

1. **Header:** wordmark "Libraria"; Zbulo / Eksploro / Biblioteka ime / Listat e leximit; global
   search; SQ·EN switch; account (name, or "Hyr" for guests). Biblioteka ime and Listat e leximit
   link to "coming soon" pages in this project.
2. **Issue line:** "Java 47 · 16 nëntor 2026" · "E zgjedhura e javës" · catalogue count
   ("62 libra · 4 botues"), on a full-width text rule.
3. **Masthead:** the featured book's title very large in serif (last word may be italic in
   `accent-2`), its description as the lede, author, publisher, price; buttons "Bli librin" (or
   "Lexo tani" when owned). On the right, its cover large with one related book overlapping and a
   short caption naming it.
4. **Strip of four:** a new book, this month's number one, a genre pick, a publisher pick; each
   with a small italic label in `accent-2`.
5. **Vazhdo leximin:** only for signed-in readers with a book in progress (up to 3, from the
   library's `last_read_at` and `reading_progress`).
6. **Të rejat:** a lead book (larger, with description) beside a grid of four with genre labels.
7. **Më të lexuarat** (this month) with large italic numerals in `accent-2`, beside **genre tiles**,
   each with a fan of three covers and a count.
8. **Publisher spotlight:** the one dark green band; monogram, name, a few facts (titles, genres,
   newest year), "Katalogu i botuesit", four books. No publisher description (there is no such
   field; see 8).
9. **Editorial interlude:** one serif line beside a shelf of covers from one genre.
10. **Footer** with columns (Libraria, Ligjore, Botuesit).

**Data: `GET /api/v1/discover`** (new, optional auth) returns the page as an ordered list of
typed sections; the web app renders whatever it receives, in order, and skips unknown types.
Sections are built from data:

- `featured`: a book with a cover, published in the last 60 days, rotating **weekly**
  (deterministic per ISO week, not random per request); includes one related book (same genre,
  else same publisher). Falls back to any available book if nothing is recent.
- `strip`, `continue_reading` (auth only), `new_releases`, `most_read` (paid sales in the
  last 30 days; a new query, because `book_sales` counts all time), `genres` (with counts and three cover ids each),
  `publisher_spotlight` (weekly rotation), `interlude` (one genre's shelf).
- The issue line's week, date and counts.

A later admin curation feature only adds a `collection` section type to the same feed. Books a
signed-in reader owns carry `owned: true` everywhere in the feed.

### 5.2 Explore (`/eksploro`, `/eksploro/:genre`, `/kerko?q=`, `/botues/:id`)

One results page serves all books, a genre, search results and a publisher's catalogue.

- Breadcrumbs; masthead with the page title (genre, "Rezultatet për …", or publisher name), a
  short description for genres (static i18n copy per genre) and a count ("18 libra · 4 botues").
- Genre bar.
- **Desktop:** left sidebar filters: publisher (checkboxes with counts), language (radio with
  counts), price range, publication date (30 days, this year, any time), toggle "Fshih librat që i
  kam" (signed in only). Removable chips for active filters and "Pastro të gjitha". Sort: newest,
  most read, title, price up, price down. Grid/list switch. 4-column grid; cards show cover,
  title (with an "EN" tag for non-Albanian books), author, publisher, and price or
  "✓ Në bibliotekën tënde".
- **Numbered pages**, not infinite scroll; all state is in the URL so pages are shareable.
- **Phone:** compact list; filters in a bottom sheet with tap-to-select options and a
  "Shfaq N libra" button showing how many match.
- **Global search** in the header on every page: suggestions after 2 characters (debounced),
  grouped as titles (with covers), authors, publishers and recent searches (recent searches kept
  in the browser only); matched letters highlighted; full keyboard navigation; Enter goes to
  `/kerko?q=`.
- Empty, loading and error states for results and suggestions.

**Backend additions:**

- `GET /api/v1/books`: add filters `publisherId` (multiple), `language`, `minPrice`/`maxPrice`
  (cents), `publishedSince`; `hideOwned` (auth only); `owned` flag per book for signed-in
  readers; search also matches publisher name.
- Facet counts for the current query (publishers, languages; per genre for the genre bar), either
  in the list response or a sibling endpoint. The phone sheet's "Shfaq N libra" uses the total.
- `GET /api/v1/search/suggest?q=`: top titles, authors (distinct author names with book count and
  main genre) and publishers.
- `GET /api/v1/publishers` and `GET /api/v1/publishers/:id`: public name, country, title count,
  genres, newest year.

### 5.3 Book page (`/libri/:id`, with a readable slug: `/libri/:id/:slug`)

- Breadcrumbs (Eksploro / genre / title).
- **Top, two columns:** large cover (with "+ Shto në një listë", hidden until project 2) and on
  the right: kicker (genre), title very large in serif, "nga <author>", publisher and month,
  description as an italic pull quote with an `accent-2` rule, then the **purchase box**, then one
  line on reading anywhere (web and app, offline).
- **Purchase box states** (only this box changes; nothing else moves):
  - *Can buy:* price ("TVSH e përfshirë"), "Bli librin". Guests are sent to sign in and returned
    to the book.
  - *Owned:* "✓ Në bibliotekën tënde që nga <date>", progress and chapter if started,
    "Vazhdo leximin" (to the coming-soon page in this project).
  - *Temporarily not for sale* (`forSale: false`: the publisher has no commission rate in force):
    "Përkohësisht nuk shitet", no button. This is not the archived state.
  - *Archived* (`archived_at` set: off sale for good, owners keep reading): non-owners get a 404;
    owners see the normal owned state.
  - *Taken down* (`withdrawn_at` set: admin takedown; licences and decryption are refused with
    `BOOK_WITHDRAWN`): non-owners get a 404. Owners still reach the page (the book stays in their
    collection), but the box says "Ky libër është hequr nga botuesi dhe nuk mund të lexohet më",
    with no reading button. The cover endpoint must serve owners for this case.
  - *Refunded earlier:* the purchase and refund dates, "Bli përsëri".
  - *Payment pending:* see 6.

  "Owned" always means an **active entitlement** (not a row in `user_libraries`). Progress uses
  the `percent` / `chapterTitle` shape the mobile app already writes.
- **Details list:** publisher (link), published date, language, length ("rreth N faqe"), format
  ("EPUB · e mbrojtur"), ISBN (hyphenated).
- **Rreth librit:** the synopsis with a drop cap in `accent-2`; genre tags.
- **Shelves:** "Nga e njëjta shtëpi botuese" and "Të ngjashme" (same genre, excluding this book;
  owned books shown as owned). "More by this author" appears only when the author has two or
  more books.
- **Phone:** stacked; price and the main button pinned at the bottom.
- **SEO:** title, description, canonical URL, Open Graph and Twitter card with the cover, and
  `schema.org/Book` JSON-LD with an `Offer` when for sale.

**Backend additions:**

- Page count: computed from the EPUB at ingestion (by the worker) and stored on the book; shown
  as approximate. Books without it omit the row.
- `GET /api/v1/books/:id` with optional auth adds a `viewer` block: `owned`, `acquiredAt`,
  `progress`, `refundedAt`, and any pending transaction for the book.
- `GET /api/v1/books/:id` currently 404s unavailable books. For a reader with an active
  entitlement it returns archived and taken-down books, with an `availability` field
  (`on_sale`, `not_for_sale`, `archived`, `taken_down`). Everyone else still gets a 404.
  Drafts and never-published books stay 404 for everyone.

### 5.4 Sign-in and registration (`/hyr`, `/regjistrohu`)

Simple pages in the same style, using `POST /auth/login` and `POST /auth/register`. A
`returnTo` parameter brings the reader back (for example to the book they were buying).
Publisher and admin accounts are told to use the publisher portal instead. Password reset is
out of scope (no backend support).

### 5.5 Coming-soon pages

Biblioteka ime, Listat e leximit and the reader route show a short, styled page saying the
feature is coming and that books are readable in the Libraria app today.

## 6. Buying, end to end

Using the existing commerce backend (`POST /api/v1/checkout`, receipts, webhooks):

1. "Bli librin" (signed in) posts `{ bookIds: [id], idempotencyKey }` through the web server.
2. **Paddle mode:** the response's `checkout.url` is Paddle's hosted checkout for the
   transaction. Paddle's "default payment link" must be a page on our site that loads Paddle.js
   and opens the overlay for the `_ptxn` parameter; the web app provides it at `/pagesa`.
   **Simulated mode** (local development, `checkout.url` is null): `/pagesa` shows a clearly
   marked development panel with "Paguaj", "Dështo" and "Anulo" buttons that call
   `POST /api/v1/sandbox/transactions/:id/events`.
3. After the provider returns, `/pagesa/:transactionId` shows "Po konfirmojmë pagesën…" and
   polls `GET /api/v1/transactions/:id` (with backoff, up to about a minute) until it leaves
   `pending` (`paid`, `failed`, `cancelled` or `expired`). Fulfilment only ever comes from the signed webhook; the page
   never grants anything itself.
4. **Paid:** "Libri është në bibliotekën tënde" with the cover and a link back to the book
   (now in the owned state). **Failed, cancelled or expired:** a plain explanation and "Provo përsëri".
   **Still pending after the wait:** "Pagesa po përpunohet; do ta shohësh librin në bibliotekë
   sapo të konfirmohet", and the book page shows a pending state.
5. A reader cannot start a second checkout for a book they already own (the box shows owned).
   Double clicks reuse the idempotency key.

**Scope of "works":** project 1 is done when buying works end to end in **simulated mode**,
covered by an automated end-to-end test. A Paddle sandbox account doesn't exist yet. The Paddle
path (`/pagesa` loading Paddle.js and opening the overlay for `_ptxn`, plus the web env settings
it needs) is built to Paddle's documented contract but is **unverified**. The plan must not
include a step that needs Paddle credentials. Verifying the adapter's `VERIFY` field paths
against real payloads is a follow-up once the account exists.

`PAYMENTS_UNAVAILABLE` (no provider configured) shows "Blerjet nuk janë ende të disponueshme"
instead of the button's action.

## 7. Architecture

- **`web/`**: React Router 7 in framework mode, server rendering, TypeScript, CSS modules
  (no Tailwind, no component kit), Radix primitives for dialogs, popovers, menus and the phone
  sheet, i18next, Vitest with Testing Library and axe. Same lint (Biome) and conventions as the
  portal. The portal's components are a reference, not a dependency: the reader site has its own
  look.
- **Sessions (backend-for-frontend):** the web server keeps the reader's API token in an
  `HttpOnly`, `Secure`, `SameSite=Lax` cookie on the website's origin. Loaders and actions run on
  the web server and call the API with `Authorization: Bearer`. The browser never sees the token.
  Client-side data needs (search suggestions, payment polling) go through web-server resource
  routes. CSRF: mutations are React Router actions (form posts) protected by `SameSite=Lax` plus
  an origin check.
- **Optional auth** on catalogue, discover and book endpoints: anonymous requests work as today;
  a valid token adds owned/progress data. Invalid tokens are treated as anonymous on these
  public endpoints.
- **Caching:** no shared cache or CDN is assumed. Every HTML response that can depend on the
  session is `Cache-Control: private`. Revisit caching when production hosting is decided.
- **Session lifetime:** the session cookie expires with the API token (7 days, no refresh). When
  it expires, the reader is treated as a guest and asked to sign in again when needed. Covers already have cache-busting URLs;
  use the existing thumbnail size for small covers.
- **URLs:** Albanian paths as listed; the language is a cookie and `Accept-Language`, not a path
  prefix. `<html lang>` follows it. English pages use the same URLs.
- **Docker:** a `web` service in `docker-compose.yml` for development. The web server calls the
  API directly (`API_URL`), so no `/api` proxy is needed and `CORS_ORIGINS` stays empty.
- **Fonts:** Source Serif 4 and Inter via `@fontsource`.
- **Images:** covers via the API's cover URLs, with `width`/`height` set to avoid layout shift and
  `loading="lazy"` below the fold.

## 8. Calls made by the designer (the owner can override)

- `text-secondary` darkened to `#6B6A62` for contrast.
- One dark band per page at most.
- Numbered pagination instead of infinite scroll.
- Albanian URL paths; language not in the URL.
- The publisher spotlight has no description text until publishers can write one.
- Genre descriptions are static i18n copy in the web app, not data.
- "Similar" means same genre for now.
- Guests can browse everything; sign-in is asked for only when buying.
- Recent searches live only in the browser.
- A taken-down book stays visible to its owners with an explanation, never silently hidden; a
  temporarily unpriced book says "Përkohësisht nuk shitet", not "no longer for sale".

## 9. Left to the builder

- Component inventory and exact API response shapes, following the existing route and error
  conventions (`{ error: { code, message, requestId } }`, zod validation, versioned `/api/v1`).
- The exact weekly rotation and fallback rules for Discover, within 5.1.
- Responsive breakpoints between phone and desktop (test intermediate tablet widths).
- How the page count is computed from the EPUB (spine text length is acceptable).
- Test coverage: backend integration tests for every new or changed endpoint; web component,
  route and accessibility (axe) tests; one end-to-end buy in simulated mode.
