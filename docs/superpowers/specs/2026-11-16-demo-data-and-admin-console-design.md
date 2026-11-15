# Demo data, publisher questions and admin console: design

Date: 2026-11-16. Status: draft for approval. This is built before the reader app's reading
side.

## Why

Libraria is a marketplace for Albanian ebooks. The owner (the user) has not yet talked to
publishers, and the financial decisions depend on those talks: commission, payouts and VAT.
The owner also wants to build as much as possible **before spending money**: no hosting and no
email service. Everything below runs on the owner's laptop.

1. **Getting ready for publisher meetings.**
   - The portal has to look real when shown. Today it holds two test sales.
   - The owner needs a list of the questions to settle with each publisher.
2. **Admin console.** When the first publisher agrees, the owner needs to:
   - create the publisher and its logins without an email service;
   - set the contract;
   - see the whole platform.
   Today this is possible only through raw API calls, and creating publishers or logins is not
   possible at all.

## Decisions (the owner's)

- **First logins use a one-time invite link.**
  - The admin creates the invite and copies the link. It is valid for 7 days and works once.
  - The admin sends the link by any channel.
  - The invitee sets their own password. The admin never knows it.
  - Once an email service exists, the same link is emailed.
- **The admin console lives inside the existing portal.** It is a fourth sidebar group,
  *Platform*, shown only to admin accounts. A separate admin app was rejected because it
  would duplicate the login, the layout and the components for one user.
- **Console scope:**
  - publishers;
  - team and invites;
  - the contract;
  - books across all publishers;
  - a platform overview;
  - reader support.
- **Later:** publishers inviting their own colleagues.
- **Questions document:** a printable Markdown file in the repo.
- **After 1 and 2:** the reader app, reading side only.

## Goals

- `npm run seed:demo` produces a convincing Albanian marketplace in a fresh database: several
  publishers, about 60 books with covers, and six months of sales.
- The questions document covers every decision payouts and contracts will need.
- The owner can onboard a publisher end to end in the portal:
  1. create it;
  2. set its rate;
  3. invite a person;
  4. that person sets a password and signs in.
- The owner can see platform-wide sales and Libraria's commission income, withdraw and
  reinstate any book, and support a reader.

## Non-goals

- Sending email.
- Self-service publisher sign-up.
- Publishers inviting colleagues.
- Payouts, balances and bank details. Payouts wait for the publisher talks; the encrypted bank
  columns stay untouched.
- Editing a publisher's books as admin. Admins already act inside the publisher pages through
  the existing publisher picker.
- Deleting publishers or users.

## Anti-goals

- Demo data that leaks into production. The demo seed refuses to run when
  `NODE_ENV=production`.
- Admin-known passwords.
- Invite tokens that appear in logs or URLs the server sees.
- Platform figures that disagree with the sum of the publisher pages.

## Part 1a: Demo data

**Command.** `npm run seed:demo` (backend).
- It refuses when `NODE_ENV=production`.
- It is idempotent: it uses fixed IDs in its own namespace, so a re-run never duplicates it: if the demo data is already loaded it stops and changes nothing
  rather than duplicating it.
- It is separate from the existing `npm run seed`, which keeps working unchanged. The two can
  live in the same database.

**Content (all invented, not real books or people).**
- **Publishers:** 3–4 Albanian-style houses, for example "Botimet Drita", "Shtëpia Botuese
  Ura" and "Onufri i Ri". The names are invented and must not match real Albanian publishers.
  Each publisher gets:
  - a contract rate. The rates differ between publishers, and one has a scheduled future rate
    so the Contracts page shows the active and scheduled statuses;
  - one publisher login (password `Password123!` locally, the same as the existing seed);
  - about 15–20 books.
- **Books:**
  - Albanian titles and authors (invented). Mostly language `sq`, a few `en`.
  - Genres: Fiction, Poetry, History, Children, Essays.
  - Prices from €3.99 to €14.99.
  - A small sample EPUB with Albanian text, built with the existing `buildSampleEpub` and
    ingested through the real pipeline.
- **Status mix:** mostly published, plus a few drafts, one or two ready-but-unpublished books,
  one archived book, and one book with a rejected upload. This fills Overview's
  "Needs attention".
- **Covers:** simple generated typographic covers (title and author on a coloured
  background), stored through the real cover path so thumbnails exist. They must not use
  third-party images.
- **Readers and sales:**
  - About 40 invented readers.
  - Six months of purchases ending today, through the real commerce path (simulated
    provider), so ledger snapshots, VAT, fees, commission and entitlements are all correct.
    Afterwards, backdate `paid_at`, and the related timestamps, to spread the sales over the
    period.
  - Buyer countries weighted AL > XK > MK > IT > DE > CH > ME > GR > US.
  - A rising trend with weekly noise, a few multi-book orders, about 3% full refunds and one
    partial refund.
- **Admin:** the existing admin account from `npm run seed` is reused. If it is missing, the
  demo seed creates it.

**Output.** At the end the command prints the logins to use (one per demo publisher plus the
admin). This is local development only.

## Part 1b: Questions for publishers

`docs/business/publisher-questions.md` is a printable checklist grouped by topic. Each question
has a one-line "why we ask" and space for the answer. The topics:

1. **Money:**
   - the commission % and what it is a % of (base B: price after VAT and payment fees);
   - minimum terms;
   - exclusivity.
2. **Payouts:**
   - frequency;
   - minimum payout;
   - currency and bank (Albania or abroad);
   - statements wanted;
   - when a sale counts as payable (refund window).
3. **Tax and VAT:**
   - who is merchant of record (Paddle on the web, the app stores on mobile);
   - their VAT status;
   - invoicing needs.
4. **Pricing:** who sets prices; launch discounts; the same price on every channel (already
   decided); price changes.
5. **Rights and territory:** the countries they hold ebook rights for; the end of a licence
   (archive keeps buyers' access, as decided); takedowns.
6. **Content and files:** EPUB availability and quality; covers; metadata; the ISBN policy;
   their catalogue size.
7. **DRM and reading:** comfort with device-bound DRM and the 5-device limit; offline reading;
   lending or sharing expectations.
8. **Data and transparency:** which reports they need; how often; who on their team needs
   access.
9. **Contract and support:** contacts; how disputes are handled; the term.

Each answer maps to a setting or an open item already in the platform, so the answers feed
straight into the payout design.

## Part 2: Admin console

### Navigation

A *Platform* group appears in the sidebar for admin accounts only, after Organization. It
contains Overview, Publishers, Books and Readers. Every route is guarded: a publisher account
gets "not found", and the API refuses it.

### Platform Overview (`/platform`)

- **Date range.** The shared top-bar date range applies.
- **Figures.** Gross sales, copies, refunds, Libraria commission (net of reversals) and
  publisher earnings.
- **Chart.** A daily bar chart.
- **Publisher table.** Gross, copies, commission and earnings per publisher, with a link to
  each publisher.
- **Definitions.** Every figure comes from the same `salesBase` and `METRICS_SQL` as the
  publisher reports, without the publisher filter. The by-publisher rows must sum exactly to
  the platform totals, and each row must equal that publisher's own Overview.

### Publishers (`/platform/publishers`)

**List.**
- Columns: name, country, contact email, current rate, number of books, gross sales for the
  range.
- Search by name.
- A "New publisher" action.

**Create and edit.**
- Name (required).
- Contact email (required, email-shaped).
- Country, required: a two-letter code from AL, XK, MK, ME, IT, DE, CH, GR, other. Albania is
  the default.
- This adds `publishers.country` (`char(2)`, nullable for existing rows) in a migration.

**Publisher page.** Tabs:
- **Details.** Editable fields.
- **Team.**
  - Shows the publisher's logins (email, name, status, created) and its pending invites
    (email, created, expires).
  - Actions:
    - invite a person (email and optional name);
    - copy the link of a new or re-issued invite;
    - cancel an invite;
    - suspend or reactivate a login (the existing user status route).
- **Contract.** Rate history with statuses, as on the publisher Contracts page, plus "Add rate"
  (rate %, effective from, contract reference) using the existing admin rate route.
- **Books.** The publisher's books, with a link into the existing publisher pages acting as
  that publisher.

### Invites

- **Data.** A `publisher_invites` table:
  - `id`, `publisher_id`, `email` (citext) and `display_name`;
  - `token_hash` (SHA-256 of a 32-byte random token; the token itself is never stored);
  - `expires_at` (creation + 7 days);
  - `accepted_at`, `accepted_user_id`, `revoked_at`;
  - `created_by` and `created_at`.
  - At most one *pending* invite per publisher and email.
- **Create.** `POST /admin/publishers/:id/invites` returns the link **once**. The token is not
  retrievable later. Re-issuing revokes the old invite and makes a new one.
- **Link format.** `{PORTAL_ORIGIN}/invite#token=…`. The token sits in the URL fragment, so it
  never reaches the server, the logs or a referrer. The portal reads it client-side.
- **Accept page.** The public portal page `/invite`:
  1. calls `POST /auth/invites/inspect {token}`, which returns the publisher name and email,
     or a clear expired, used or revoked state;
  2. lets the person set a display name and a password (the same rules as registration);
  3. calls `POST /auth/invites/accept {token, password, displayName}`.
  The accept step creates a `publisher` user tied to the publisher, marks the invite accepted
  in one transaction (single use, enforced under lock), and signs them in with the portal
  cookie.
- **Refusals.**
  - If an account already exists for that email: `409 EMAIL_TAKEN` (the existing registration code). Accounts are not
    converted between roles.
  - Wrong, expired, used or revoked tokens are all `410 INVITE_INVALID`, with a reason the page
    can show.
  - Inspect and accept are rate-limited.
- **Configuration.** `PORTAL_ORIGIN` is a new env setting. In dev it is the Vite origin.

### Books, platform-wide (`/platform/books`)

- **Table.** Every book across publishers: title, publisher, status, price, copies and gross
  sales.
- **Controls.** Search, a publisher filter and a status filter (including withdrawn and
  archived). Pagination and sort follow the Catalog pattern.
- **Actions.**
  - Withdraw requires a reason and uses the existing admin route. The confirm text says buyers
    lose access.
  - Reinstate is available on withdrawn books.
- **API.** `GET /admin/books`, reusing `BOOK_SELECT_COLUMNS` and `BOOK_STATUS_SQL` without
  publisher scope and adding the publisher name.

### Readers (`/platform/readers`)

- **Lookup.** Exact email or prefix search over reader accounts only.
- **Reader page.** Email, name, status, created date, number of books owned, devices (counted
  and removed) and device removals used this year.
- **Actions** (all existing admin routes):
  - suspend or reactivate;
  - remove a device;
  - reset the device-removal allowance.
- **API.** New `GET /admin/readers?q=` and `GET /admin/readers/:id`, both read-only.

### Cross-cutting

- Every new screen follows the portal design system and the Checkpoint 1 rulings, in en and sq
  with identical keys, and passes the axe checks.
- Every admin endpoint requires `role = admin`. The rate-limit and error conventions are the
  existing ones.
- The admin portal user is still the existing seeded admin. Creating more admins is not in
  scope.

## Approaches considered

| Decision | Options | Chosen |
|---|---|---|
| First login without email | Invite link · temporary password | Invite link (owner) |
| Where the console lives | Inside the portal · separate app | Inside the portal (owner) |
| How demo sales are made | Direct SQL inserts · the real commerce path, then backdated | The real path: snapshots, commission and entitlements stay correct by construction |

## One account per email (owner's decision, revisit later)

- **The rule.** One email has one account, and an account is either a reader or a publisher
  login. An invite to an email that already has a reader account fails with `409 EMAIL_TAKEN` (the existing registration code).
  The accept page then explains that the person should use another email, for example a work
  address.
- **Revisit later.** The owner asked to revisit this. One account holding both roles would
  change how accounts and logins are modelled. It is noted under open items in the README.

## Answers and calls from the builder check

**Answered by the code as it stands**
- **Refunds.** The simulated provider already supports full and partial refunds
  (`POST /sandbox/transactions/:id/events` with `kind: 'refund'` and an optional partial
  amount). `METRICS_SQL` already reports commission and earnings net of reversals. The demo
  seed uses these routes, or the same service functions, for its refunds. There are no direct
  SQL inserts for sales or refunds.
- **Suspension.** A suspended login is blocked on its next request, including portal cookie
  sessions. `requireAuth` checks `accountStatus` and the cache is invalidated by the status
  route. Team "suspend" uses that route.
- **Publisher email.** `publishers.contact_email` already exists (citext, not unique). Only
  `country` is new.
- **Ledger rows.** No triggers make them immutable, so backdating them in the seed is possible.

**Calls made by me (correct me if any is wrong)**
- **Re-running the demo seed.** `seed:demo` is safe to re-run without resetting anything. If
  the demo publishers already exist it stops and says "Demo data is already loaded; run
  `docker compose down -v && docker compose up` for a fresh database", without deleting
  anything. There is no partial delete path for ledger rows.
- **Backdating and contract rates.** Sales are attributed by `paid_at` in UTC, which is what
  `salesBase` filters on. After each simulated purchase, the seed backdates the transaction's
  `created_at`/`paid_at`, the related payment events, the entitlement and library
  `created_at`, and any refund timestamps, consistently. Each demo publisher's active rate has
  `effective_from` before the earliest demo sale, so every snapshotted rate matches the active
  contract. The scheduled future rate starts next month and affects no demo sale.
- **A publisher may exist with no rate.** Sales then stay unsplit, which is the existing
  `no_rate` behaviour. The publisher list shows "No contract yet" in the rate column, and
  the platform Overview flags publishers without a rate.
- **`PORTAL_ORIGIN`.** It defaults to `http://localhost:5173` in development and is required
  in production: env validation fails without it. The invite accept route sets the same
  portal cookie as `POST /auth/portal/login`, and the dev proxy keeps the portal and the API
  on the same origin.
- **Invites.**
  - **One open invite per publisher and email.** A partial unique index on
    `(publisher_id, email)` applies while `accepted_at IS NULL AND revoked_at IS NULL`.
    Creating an invite first revokes any expired open one for the same pair.
  - **Email is fixed.** The invitee cannot change it.
  - **Audit.** Accepting writes an audit entry (`invite.accepted`), and so do creating and
    revoking.
  - **Same email, two publishers.** One email may have open invites from two publishers.
    Accepting one makes the other fail with `EMAIL_TAKEN`, because an account belongs to one
    publisher.
- **Reader lookup.**
  - Prefix search needs at least 3 characters. An exact match is always allowed.
  - Results are limited to 20.
  - Opening a reader's page writes an audit entry (`reader.viewed`). Writes are already
    audited.
- **Platform Books figures.** Copies and gross use the same definitions as the publisher
  Catalog. Sales of withdrawn and archived books still count, because sales history is
  unchanged.

## Left to the builder

- The exact demo titles, authors, numbers and random seed. The output must be deterministic,
  so the same command produces the same data.
- How the covers are rendered locally. The cover module blocks the SVG loader inside its
  process.
- The component layout of the new pages, within the design system.
- The exact copy, in natural Albanian that matches the existing terms.
