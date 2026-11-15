# Libraria

Cross-platform EPUB bookstore, e-reader and publisher platform.

| Directory  | What it is                                                  |
| ---------- | ----------------------------------------------------------- |
| `backend/` | Node.js 24, Express 5, TypeScript, PostgreSQL 15            |
| `mobile/`  | Expo / React Native reader app (TypeScript)                 |

The governing design document is the **Libraria Technical Architecture &
Development Specification v2.1**. Section 2 of that spec records what is
implemented versus proposed; please do not describe proposed controls (KMS,
real payments, production DRM) as done.

## Quick start (Docker)

Requires Docker Desktop.

```sh
cp .env.example .env          # optional; compose has the same defaults
docker compose up --build
```

On start the backend container installs dependencies if `package-lock.json`
changed, applies database migrations, then runs the API with hot reload on
<http://localhost:3000>. Check it with `curl http://localhost:3000/health`. File watching uses polling, so edits made on
a Windows or macOS bind mount reload the API.

After pulling changes that add migrations or touch the worker, run
`docker compose restart backend worker`: migrations run at container start and
the worker does not hot-reload.

Load demo data (publisher, users, encrypted sample books):

```sh
docker compose exec backend npm run seed
```

Start from an empty database at any time (this deletes local data):

```sh
docker compose down -v && docker compose up --build
```

## Running the backend on the host

Useful for debugging and for the integration tests. Postgres still runs in
Docker:

```sh
docker compose up -d db
cd backend
cp .env.example .env
npm ci
npm run migrate
npm run dev
```

Book uploads are processed by a separate worker. Without it running, uploads stay
`uploaded` forever, so start it in a second terminal:

```sh
npm run worker
```

### Backend scripts

| Script                     | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev`              | API with hot reload                                        |
| `npm run worker`           | Asset-ingestion worker (uploads stay `uploaded` without it) |
| `npm run migrate`          | Apply pending migrations                                   |
| `npm run seed`             | Insert demo data                                           |
| `npm run lint`             | Biome lint and format check (`lint:fix` to apply)          |
| `npm run typecheck`        | TypeScript, including tests                                |
| `npm test`                 | Unit tests (no database needed)                            |
| `npm run test:integration` | API tests against a real Postgres, see below               |
| `npm run build`            | Compile to `dist/`                                         |

## Database migrations

Schema lives in `backend/db/migrations/NNNN_description.sql`, applied in order,
each in its own transaction, and recorded in `schema_migrations` with a
checksum.

- **Never edit a migration that has been merged.** The runner refuses to start
  if an applied file's checksum changes. Add a new numbered file instead.
- Migrations are forward-only. To undo something, write a new migration.
- In production, migrations are an explicit deploy step, not part of app boot:
  `node dist/db/migrate.js` (the production image ships `db/`).

## Testing

Integration tests start the real Express app on a random port against a
separate database, `libraria_test`, which they create, migrate and empty as
needed. The harness refuses to run against any database whose name does not
end in `_test`.

```sh
docker compose up -d db
cd backend && npm run test:integration
```

They cover authentication, role enforcement, publisher tenant isolation,
library ownership, and the payment lifecycle. The payment tests go through the
real webhook endpoint with forged, stale, replayed and concurrent deliveries,
and cover refunds, disputes and chargebacks. These correspond to spec 13.1
scenarios 1 to 4. CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit
tests, migrations against a fresh database, integration tests, the build and
the production image build on every push and pull request.

## API conventions

- All endpoints are under **`/api/v1`**. `/health` is unversioned, for
  infrastructure probes.
- Every response carries an `X-Request-Id` header. A well-formed incoming
  `X-Request-Id` is reused, so mobile and server logs can be correlated.
- Errors always have this shape:

  ```json
  { "error": { "code": "ALREADY_OWNED", "message": "You already own this book", "requestId": "…" } }
  ```

  Validation failures add `details: [{ path, message }]`. Codes are listed in
  `backend/src/middleware/errors.ts` and are part of the public contract:
  clients branch on `code`, never on `message`.
- Logs are JSON lines. Never log tokens, keys, signed URLs, passwords or book
  content.

## Payments

Paddle Billing is the payment provider and merchant of record: it charges the
customer and handles VAT. Prices are in EUR, tax-inclusive.

### How a purchase works

1. The app calls `POST /api/v1/checkout-sessions` with `bookIds` and an
   `idempotencyKey`. The backend prices the books from the database, writes a
   `pending` transaction with per-item price and publisher snapshots, and
   creates a Paddle checkout. **Nothing is granted yet.**
2. The customer pays on Paddle's checkout page. The app polls
   `GET /api/v1/transactions/:id`.
3. Paddle sends a signed webhook to `POST /api/v1/webhooks/paddle`. The
   backend verifies the signature and timestamp, records the event (each
   event id is processed exactly once), checks the amount, then marks the
   transaction `paid` and grants entitlements in one database transaction.
4. Refunds and chargebacks arrive as webhooks too. A full refund or a lost
   chargeback revokes access; the receipt and the reader's annotations remain.

Library access is checked against active `entitlements`, never against the
transaction or anything the app says.

### Modes (`PAYMENTS_MODE`)

| Mode        | Use                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `simulated` | Development and tests. No provider; `POST /api/v1/sandbox/transactions/:id/events` plays Paddle's part by sending **signed** webhooks through the real path. Refused when `NODE_ENV=production`. |
| `paddle`    | Real checkout. Requires `PADDLE_API_KEY` and `PADDLE_WEBHOOK_SECRET`; `PADDLE_ENVIRONMENT` is `sandbox` or `production`.                                                                    |
| `disabled`  | Checkout returns `503 PAYMENTS_UNAVAILABLE`. The production default.                                                                                                                         |

### Paddle setup checklist

1. Create a Paddle **sandbox** account and API key with `transaction.write`.
2. Make sure the **`ebooks` tax category** is enabled on the account; books
   are sent in that category.
3. Set a **default payment link** (Checkout settings); Paddle's checkout URL
   is built from it.
4. Add a **notification destination** for
   `https://<your-host>/api/v1/webhooks/paddle` with the events
   `transaction.completed`, `transaction.payment_failed`,
   `transaction.canceled`, `adjustment.created` and `adjustment.updated`.
   Copy its secret into `PADDLE_WEBHOOK_SECRET`.
5. Keep server clocks NTP-synced: webhook timestamps older than
   `WEBHOOK_TOLERANCE_SECONDS` (default 5, as in Paddle's SDKs) are rejected.
6. Make one sandbox purchase and refund. Check that `payment_events.outcome`
   is `applied`; `ignored` with an `unparseable` detail means a Paddle field
   path needs adjusting in `backend/src/commerce/providers/paddle.ts`
   (marked `VERIFY`).

### Policies currently implemented (change deliberately)

- A **full refund** revokes access; a **partial refund** (goodwill) keeps it.
- During a **dispute** access is kept; a **lost chargeback** revokes it.
- A provider amount or currency that differs from ours marks the transaction
  `paid` but grants nothing and sets `review_reason` for a person to check.
- Two paid checkouts for the same book grant once and flag the second for a
  refund (`review_reason`).
- **Platform commission** is a percentage of what is left after VAT and the
  payment fee: `libraria = floor(net × rate)` and `publisher = net − libraria`,
  where `net = price − VAT − provider fee`. The formula lives only in
  `backend/src/commerce/commission.ts`.
  - Rates are per publisher contract, in basis points (2000 = 20%), with a
    start date. Admins add them with
    `POST /api/v1/admin/publishers/:id/commission-rates`. Rates are never
    edited; a new contract is a new row. Publishers see theirs at
    `GET /api/v1/publisher/contract`.
  - Each sold item snapshots the rate at checkout, so a contract change never
    alters past sales. A publisher with no rate in force cannot sell
    (`409 BOOK_NOT_FOR_SALE`), and the catalogue reports `forSale: false` for
    its books so the app hides "Buy". **Before deploying, add a rate for every
    live publisher:** the migration does not invent one.
  - Refunds reverse both shares in proportion to the amount refunded, rounding
    in the publisher's favour. A lost chargeback reverses them in full. The
    provider fee is **not** reversed: `provider_fee_cents` keeps the fee from
    the original sale, so reconcile refunded fees against the provider's
    reports.
  - A sale whose shares cannot be computed (provider fee unreported) is
    flagged in `review_reason` ("commission not split") rather than counted as
    0% silently.
  - `GET /api/v1/publisher/stats` reports `totalEarningsCents` and
    `totalPlatformCommissionCents` next to gross revenue; each book's
    `metrics.earningsCents` on `/publisher/books` is its publisher share.
  - `GET /api/v1/publisher/reports/{summary,by-book,by-country,sales}` and
    `sales.csv` feed the publisher portal (see **Portal** below). Admins pass
    `publisherId`; publishers are always scoped to their own house.
  - `POST /api/v1/auth/portal/login` and `/portal/logout` set and clear the
    portal's session cookie. A cookie-authenticated write must send
    `X-Libraria-Portal: 1`, otherwise `403 CSRF_CHECK_FAILED`. Mobile Bearer
    requests are unaffected.

## Portal

The publisher portal (`portal/`) is a React single-page app for publishers
(and admins acting for one): sales and earnings reporting, the book catalogue,
EPUB and cover uploads, statements and the commission contract. It is in
Albanian and English; the Albanian text has been reviewed by the project owner.

```sh
cd portal
npm ci
npm run dev
```

The API must be running on `:3000`. The dev server proxies `/api` to it, so
the portal and API share an origin and `CORS_ORIGINS` stays empty in dev.

- **Navigation.** A sidebar with three groups. *Workspace*: Overview, Catalog
  (grid or table, search, status filter, a book page with Details, Sales,
  Analytics, Distribution and Files & DRM tabs, and the add/edit form),
  Sales & Orders and Analytics. *Financials*: Earnings, Transactions, Payouts
  and Statements. *Organization*: Contracts and Settings. One date range in
  the top bar (`?from&to` in the URL) applies to Overview, Sales & Orders,
  Transactions, Analytics and Earnings; Catalog, Contracts and Settings do
  not use it. On narrow screens the sidebar becomes a drawer. Old `/books`
  and `/contract` links redirect to `/catalog` and `/contracts`.
- **Covers.** The book form and page upload a cover straight from the
  browser (JPEG, PNG or WebP; see **Covers** below). Grids and tables show the
  480 px thumbnail, and a typographic placeholder when a book has no cover.
  The old Cover URL field is gone.
- **Book language.** Libraria is an Albanian ebook marketplace: the book form
  offers Albanian (`sq`, the default) or English (`en`), and the API accepts
  only those two codes for now (`BOOK_LANGUAGES` in
  `backend/src/routes/publisher.ts`, mirrored in `portal/src/lib/bookLanguages.ts`).
- **Contracts and Settings.** Contracts shows the current commission rate,
  start date, reference and a status (active, scheduled or superseded, taken
  from the server) plus the full history. Settings is read only: account
  email and name (there is no update endpoint), the live language switch and
  sign out, a link to the contract, and a "coming later" list (team and
  roles, payment settings, profile and storefront) that has no controls.
- **Design system.** Tokens live in `portal/src/ui/tokens.css` and the
  components in `portal/src/ui/`, styled with CSS modules: no Tailwind and no
  component kit (Radix primitives for dialogs, popovers and tabs). Inter is
  the interface font; Instrument Serif is used only for the brand and page
  titles. Both are self-hosted through `@fontsource`, so there is no font
  CDN. The palette is warm neutrals with a deep green accent and a burgundy
  second colour; no blue. Charts of daily data are bars, never smoothed
  curves.
- **Accessibility.** Keyboard navigation with a 2 px accent focus ring,
  status never shown by colour alone, reduced motion respected, and an axe
  check on the main pages in the test suite. Every data view handles loading,
  empty, error and stale data (a "Last updated" stamp and refetch on focus),
  and an admin without a selected publisher is asked to pick one.
- **Not set up yet.** Payouts and the pending, available and paid balances
  are not built: those screens say so and show **no figures**. Statements are
  CSV only (PDF is marked "coming soon"). Team and roles, payment settings and
  profile editing are listed in Settings as coming later.
- **Login** uses an HttpOnly cookie (`libraria_portal`, `SameSite=Lax`,
  `Path=/api`, `Secure` in production) set by `POST /api/v1/auth/portal/login`.
  Only publisher and admin accounts may sign in. **In production the portal
  and the API must be served from the same site** (for example
  `portal.example.com` and `api.example.com`, or one host with `/api`
  proxied), because the cookie is `SameSite=Lax`.
- Settings (`backend/.env.example`): `CORS_ORIGINS` is a comma-separated list
  of portal origins allowed to call the API with credentials (empty by
  default); `PORTAL_SESSION_HOURS` (12) is the lifetime of a session login;
  `PORTAL_REMEMBER_DAYS` (30) is the lifetime with "Remember me".
- **Reporting rules.** A sale is an item whose transaction is `paid`,
  `partially_refunded`, `disputed` or `refunded`. Periods use
  `transactions.paid_at` in **UTC** (`from` inclusive, `to` exclusive, weeks
  start on Monday). A refund counts in the period of the sale it refunds, not
  the refund date. VAT and payment fees are shown **as at the time of sale**.
  Commission is shown as at sale only in the Earnings by-month, by-book and
  by-country tables, where refund reversals appear on their own line; the
  Sales lines and the CSV show commission and earnings **after refund
  reversals**. A line's status is the item's own: `refunded`, else
  `partially_refunded`, else `disputed`, else `paid`. Sales whose provider fee
  is not yet known show "Fee pending" and are not counted in earnings until
  split.
- **CSV export.** Sales & Orders and Transactions export the current filters,
  and Statements exports whole months or whole years (and, when an export is
  too large, weekly or monthly parts), from
  `GET /api/v1/publisher/reports/sales.csv`, in the portal's language.
  Cells starting with `=`, `+`, `-` or `@` are neutralised so spreadsheets
  do not run them.
- **Pointing a built portal at the API.** In dev the Vite proxy forwards
  `/api` to the backend, so the default API base is `/api/v1`. For a
  production build served from a different origin, set `VITE_API_BASE` at
  build time (for example `VITE_API_BASE=https://api.example.com/api/v1
  npm run build`) and add the portal's origin to `CORS_ORIGINS`.
- The portal never computes money; it formats figures supplied by the API.
- Publishing a book needs a ready, live EPUB. The book's edit page has an
  **Upload EPUB** panel that lists versions, shows processing progress and
  makes a ready version live (see **Books and DRM**). Failure reasons are shown
  in the portal's language, never as backend text.

## Books and DRM

Uploaded EPUBs are validated, scanned, encrypted per book version and stored by
a background worker. Readers get a book only through a short-lived download
grant plus a device-bound licence; the server never hands out plaintext.

> **Accepted residual risk (spec 17.10).** An authorized but compromised
> client can extract the DEK or the plaintext. This DRM raises the bar against
> casual copying and leaks of stored files; it cannot stop a determined,
> entitled user with a modified app.
>
> **Production cannot boot yet, by design.** Local KMS and local storage are
> development substitutes and startup refuses them when `NODE_ENV=production`:
> `KMS_PROVIDER=local`, `STORAGE_PROVIDER=local` (the only storage provider that
> exists), `SCANNER=none`, the built-in development KEK and the built-in
> development licence signing key. Because no managed KMS adapter and no managed
> object-storage adapter exist yet, **the backend cannot start in production at
> all until they are written. That blocks everything else in production too:
> commerce and the portal included.** **DRM is not production-ready until a
> managed KMS and storage are configured and the 17.11 release gate is met.** Do
> not describe it as production DRM before then.

### Pipeline and states

`POST /api/v1/publisher/books/:bookId/assets` takes the raw EPUB as the body
(`Content-Type: application/epub+zip` or `application/octet-stream`, up to
`ASSET_MAX_UPLOAD_BYTES`, 100 MB) and answers `202` with the new version. The
worker then moves it through:

`uploaded` -> `validating` -> `scanning` -> `encrypting` -> `storing` ->
`ready`, or ends in `rejected` (the file is unacceptable; `reasonCode` says
why) or `failed` (an operational problem; an admin can retry).

- A `ready` version is **not live** until activated
  (`POST .../assets/:assetId/activate`); the book's `current_asset_id` is what
  readers receive. Activating an unfinished version is `409 ASSET_PROCESSING`.
- One upload per book at a time (`409 ASSET_PROCESSING`); `413 PAYLOAD_TOO_LARGE`
  is sent as soon as the declared or streamed size passes the limit;
  `429 RATE_LIMITED` after 20 uploads per hour per publisher.
- Validation limits: at most 500 MB uncompressed, 10,000 entries, and a 100:1
  compression ratio for entries over 1 MB. Scripts, remote resources, nested
  encryption, unsafe or duplicate paths are rejected. Reason codes:
  `NOT_AN_EPUB`, `ARCHIVE_TOO_LARGE`, `TOO_MANY_ENTRIES`, `COMPRESSION_RATIO`,
  `UNSAFE_PATH`, `DUPLICATE_ENTRY`, `INVALID_CONTAINER`, `INVALID_PACKAGE`,
  `UNSUPPORTED_ENCRYPTION`, `ENCRYPTED_ARCHIVE`, `SCRIPTED_CONTENT`,
  `REMOTE_RESOURCES`, `UNSUPPORTED_MEDIA`, `MALWARE_DETECTED`,
  `SCAN_UNAVAILABLE`, `PROCESSING_TIMEOUT`, `PROCESSING_ERROR`.
- Encryption is AES-256-GCM with a random key per version, wrapped by the KMS.
  Plaintext keys and EPUB bytes are never stored or logged.
- Jobs get 3 attempts with backoff, a processing timeout
  (`ASSET_PROCESSING_TIMEOUT_MS`, 60 s) and a lease: a job whose lock is older
  than 3x the timeout is reclaimed. Failed originals are kept 7 days.

### The worker

The worker is a separate process (`npm run worker`; the `worker` service in
`docker-compose.yml`) that shares the code and database of the API.
**In production it must run without outbound network access**: it handles
untrusted archives and only needs the database, storage, the KMS and the
scanner.

Malware scanning uses ClamAV. The service sits behind a compose profile and is
not started by default:

```sh
docker compose --profile scan up        # starts clamav too; set SCANNER=clamav
```

With `SCANNER=none` (development only) nothing is scanned. The compose `clamav`
service sets clamd's limits explicitly for 100 MB uploads and 500 MB uncompressed
(`CLAMD_CONF_*` variables) and `AlertExceedsMax yes`, so an oversize file is an
alert, not silently clean.

The production image runs the API with `npm run start` (`node dist/index.js`) and
the worker with `npm run start:worker` (`node dist/worker.js`): run both from the
same image, with the worker as its own service.

### Covers

Uploading is the way covers get into Libraria; there is no cover URL field any
more (`coverImageUrl` is rejected by the create and update endpoints).

- `PUT /api/v1/publisher/books/:bookId/cover` takes the raw image as the body
  (`image/jpeg`, `image/png`, `image/webp` or `application/octet-stream`; admins
  add `?publisherId=`) and answers `200 { book }`. `DELETE` on the same path
  removes the uploaded cover. Uploading to a withdrawn book is `403`. Both
  share a limit of 60 changes per hour per publisher.
- Input: JPEG, PNG or WebP up to 10 MB, at least 400 px wide, at most 40
  megapixels, and no more than 3 times longer than wide (or the reverse). The
  type comes from the file's magic bytes and the image decoder, not from the
  Content-Type or the file name; other image loaders are disabled in `sharp`.
- Refusals: `COVER_TOO_LARGE` (413), `COVER_UNSUPPORTED_TYPE` (415),
  `COVER_TOO_SMALL` (422), `COVER_BAD_SHAPE` (422), `COVER_INVALID` (422:
  undecodable, truncated or over the pixel limit) and `COVER_BUSY` (503 with
  `Retry-After`: 2 images are processed at once, 8 may wait). The 413 comes
  before any body is read only when the client declares a `Content-Length`; a
  chunked body is cut off once it passes 10 MB.
- The server re-encodes with `sharp` (pinned): upright, all metadata stripped,
  sRGB JPEG at quality 85, long side at most 2400 px, transparency flattened on
  white, plus a thumbnail that fits within 480 x 720 and is never enlarged.
  Objects are stored as `covers/{bookId}/u-{uuid}.jpg` and `...-thumb.jpg`;
  replaced objects are deleted after the database update commits. If that
  deletion fails (or the process stops before it), the orphaned
  `covers/*/u-*` objects stay: they are not swept yet.
- An uploaded cover wins over the cover extracted from the EPUB, which shows
  only without one (and after `DELETE`).
- `coverImageUrl` is `/api/v1/books/{id}/cover?v={n}` and `coverThumbUrl` is
  `/api/v1/books/{id}/cover?size=thumb&v={n}` (null without an uploaded cover).
  `n` increases on every upload, removal, activation of another asset and
  first appearance of an EPUB cover, so the one-day public cache never shows a
  stale cover for a URL taken from the API.

### Devices, licences and downloads

Policy numbers:

- At most **5 devices** count against an account: not revoked and seen within
  the last **90 days**.
- At most **3 device removals per rolling 365 days**, counted only when the
  device had been issued a licence. Admins can reset the counter.
- A device licence is valid **30 days** (`LICENCE_DAYS`), then the app must
  renew it; a revoked device, suspended account or withdrawn book stops renewal.
- Download tokens are 256 random bits, valid 5 minutes, reusable within that
  time; only their SHA-256 is stored.
- Rate limits (in memory, per instance): 10 authorizations per hour per device
  and asset, 60 licence-status checks per hour per device, 300 grants per hour
  per user.

Clients see only `403 ASSET_ACCESS_DENIED` or `429 RATE_LIMITED` for refused
grants (the precise reason is logged), plus two `409`s that are sent only after
ownership and entitlement have passed: `ASSET_SUPERSEDED` and
`DEVICE_LIMIT_REACHED` (see the reader contract below).

**Reverse proxies and log shippers must not log `/api/v1/asset-downloads/*`**:
the download token is part of the path.

### Reader contract

Everything a reader app needs to fetch, verify and decrypt a book.

> **The reader MUST render EPUB content with scripts and network access
> disabled**: a strict Content-Security-Policy or sandbox (no script execution,
> no remote loads of any kind, no navigation out). Server-side detection of
> scripts and remote resources at upload is heuristic and cannot be the only
> defence. The reader must also **ignore the ZIP Info-ZIP Unicode Path extra
> field** (0x7075) and use only the standard entry names, because the server's
> path checks do not see the alternative name that field provides.

**Device public key.** `POST /api/v1/devices` takes `{ platform, displayName,
publicKey }`. `publicKey` is the base64url of an **uncompressed P-256 SPKI DER**
key (91 bytes). WebCrypto and Android export this directly; **iOS exports a raw
X9.63 point and must wrap it in the SPKI prefix** before sending. Anything else
(garbage, other curves, compressed points, private keys) is `400 VALIDATION_FAILED`.

**Fetching.** `POST /api/v1/assets/:assetId/download-authorizations` with
`{ deviceId }` returns `{ downloadUrl, expiresAt, sizeBytes, sha256 }`.
`downloadUrl` is **relative to the API origin** (`/api/v1/asset-downloads/<token>`).
The downloaded file is the **raw ciphertext**: no header, no nonce, no tag. The
nonce and auth tag are in the licence. `sha256` (hex) is of the ciphertext.

**The licence.** `POST /api/v1/assets/:assetId/decryption-authorizations` with
`{ deviceId }` returns `{ licence }`:

```json
{
  "v": 1,
  "kid": "3f9a0c1d2b4e5f60",
  "licenceId": "<uuid>",
  "assetId": "<uuid>",
  "assetVersion": 1,
  "bookId": "<uuid>",
  "deviceId": "<uuid>",
  "issuedAt": "2026-01-01T00:00:00.000Z",
  "expiresAt": "2026-01-31T00:00:00.000Z",
  "content": {
    "algorithm": "AES-256-GCM",
    "nonce": "<base64url, 12 bytes>",
    "authTag": "<base64url, 16 bytes>",
    "aad": { "assetId": "<uuid>", "version": 1, "algorithm": "AES-256-GCM", "kmsKeyId": "local" }
  },
  "wrappedKey": {
    "alg": "ECDH-ES+HKDF-SHA256+A256GCM",
    "epk": "<base64url SPKI DER>",
    "iv": "<base64url, 12 bytes>",
    "ciphertext": "<base64url, 32 bytes>",
    "tag": "<base64url, 16 bytes>"
  },
  "signature": "<base64url Ed25519>"
}
```

**Signature.** Ed25519 over the canonical JSON of the licence **without
`signature`** (so `kid` is signed), base64url. Canonical JSON: object keys sorted
recursively (by UTF-16 code unit), arrays in order, no whitespace, standard JSON
string escaping. Fetch the key from `GET /api/v1/drm/licence-signing-key`, which
returns `{ algorithm: "Ed25519", kid, publicKeyPem }`; `kid` is the first 16 hex
chars of the SHA-256 of the public key's SPKI DER and names the key that signed a
licence, so keep the key for each `kid` you have seen and refetch on an unknown
one. Verify the signature before trusting anything in the licence.

**Unwrapping the key (DEK).**

1. ECDH with the device private key and `wrappedKey.epk` (P-256, uncompressed SPKI
   base64url) gives the shared secret.
2. HKDF-SHA-256 with `ikm` = shared secret, `salt` = UTF-8 of `licenceId`,
   `info` = UTF-8 `"libraria-licence-v1"`, 32 bytes out gives the wrap key.
3. AES-256-GCM decrypt `wrappedKey.ciphertext` with the wrap key, IV
   `wrappedKey.iv` (12 bytes), tag `wrappedKey.tag` and AAD
   UTF-8 `${licenceId}|${assetId}|${deviceId}`. The result is the 32-byte DEK.

**Decrypting the book.** AES-256-GCM with the DEK, IV `content.nonce`, tag
`content.authTag`, over the downloaded ciphertext, with AAD UTF-8
`${assetId}|${version}|AES-256-GCM|${kmsKeyId}` (all from `content.aad`). Zero the
DEK after use.

**Check-in.** `POST /api/v1/licences/status` with `{ deviceId, licenceIds }`
(1 to 500 ids) returns `{ licences: [{ licenceId, status, currentAsset? }] }`.
Statuses, in precedence order (the first that applies wins):

| Status | Meaning | App action |
| --- | --- | --- |
| `unknown` | Not issued to this user and device, or does not exist | Discard it |
| `revoked` | Licence revoked, device revoked, account suspended, book withdrawn, or entitlement gone (refund) | Delete the local copy |
| `replaced` | A newer version is live; `currentAsset` is `{ assetId, version, sizeBytes, sha256 }` | Download and license the new version |
| `superseded` | A newer licence for this book on this device exists | Use that one |
| `expired` | Past `expiresAt` | Request a new licence |
| `valid` | Usable | Keep using |

A suspended account **can** call this route (it still needs a valid token and a
device it owns) so that it receives `revoked`; its device's `last_seen_at` is not
refreshed. Every other authenticated route refuses a suspended account with
`403 ACCOUNT_SUSPENDED`.

**Error shapes.**

- `409 ASSET_SUPERSEDED`, sent only after every other check passes:
  `error.details = { currentAssetId, version, sizeBytes, sha256 }` of the live
  version. Request grants for that asset instead.
- `409 DEVICE_LIMIT_REACHED`: `error.details = { devices: [ ... ] }`, the user's
  counted devices (`id`, `platform`, `displayName`, `registeredAt`, `lastSeenAt`,
  `revokedAt`, `counted`). Returned by `POST /devices` when 5 devices are counted,
  and by both authorization routes for a device that lapsed (90 days unseen) while
  all 5 slots are taken. The user must remove a device first.
- `409 DEVICE_REMOVAL_LIMIT`: the 3-per-year removal cap (`DELETE /devices/:id`).

**Unknown or foreign devices.** A device that does not exist is indistinguishable
from another user's, by design:

| Route | Response |
| --- | --- |
| `POST /assets/:assetId/download-authorizations`, `.../decryption-authorizations` | `403 ASSET_ACCESS_DENIED` |
| `POST /licences/status` | `403 ASSET_ACCESS_DENIED` |
| `DELETE /devices/:deviceId` | `404 NOT_FOUND` |
| `DELETE /library/:bookId/device-access` | `404 NOT_FOUND` |
| `POST /devices` with an admin-revoked key | `403 FORBIDDEN` |

### Endpoints

| Endpoint | Who | Purpose |
| --- | --- | --- |
| `POST /api/v1/publisher/books/:bookId/assets` | publisher, admin | Upload an EPUB (raw body); `202` |
| `GET /api/v1/publisher/books/:bookId/assets` | publisher, admin | Versions, newest first |
| `GET /api/v1/publisher/books/:bookId/assets/:assetId` | publisher, admin | One version, with extracted metadata |
| `POST /api/v1/publisher/books/:bookId/assets/:assetId/activate` | publisher, admin | Make a ready version live |
| `POST /api/v1/devices` | reader | Register a device (P-256 public key) |
| `GET /api/v1/devices` | reader | List own devices |
| `DELETE /api/v1/devices/:deviceId` | reader | Remove a device |
| `POST /api/v1/assets/:assetId/download-authorizations` | reader | Short-lived download grant |
| `GET` / `HEAD /api/v1/asset-downloads/:token` | grant holder | Ciphertext download, `Range` supported |
| `POST /api/v1/assets/:assetId/decryption-authorizations` | reader | 30-day device-bound licence |
| `POST /api/v1/licences/status` | reader | Which licences are still valid |
| `GET /api/v1/drm/licence-signing-key` | public | Ed25519 public key for licence signatures |
| `DELETE /api/v1/library/:bookId/device-access` | reader | Drop this device's access to a book |
| `PUT /api/v1/publisher/books/:bookId/cover` | publisher, admin | Upload a cover image (raw body) |
| `POST /api/v1/publisher/books/:bookId/archive` | publisher, admin | Take a title off sale for good; buyers keep access. `409 BOOK_ARCHIVED` if already archived, `403` if withdrawn |
| `POST /api/v1/publisher/books/:bookId/restore` | publisher, admin | Un-archive; the title stays unpublished |
| `DELETE /api/v1/publisher/books/:bookId` | publisher, admin | Permanently delete a never-sold title and its files; `204`. `403 FORBIDDEN` withdrawn, `409 BOOK_PUBLISHED`, `ASSET_PROCESSING`, `BOOK_HAS_SALES` |
| `DELETE /api/v1/publisher/books/:bookId/cover` | publisher, admin | Remove the uploaded cover |
| `GET /api/v1/books/:bookId/cover` | public | Uploaded cover, else the EPUB's; `?size=thumb` |
| `PATCH /api/v1/admin/users/:id/status` | admin | Suspend or reactivate an account |
| `GET /api/v1/admin/users/:id/devices` | admin | A user's devices |
| `DELETE /api/v1/admin/devices/:deviceId` | admin | Revoke a device |
| `POST /api/v1/admin/users/:id/device-removals/reset` | admin | Reset the removal counter |
| `POST /api/v1/admin/assets/:assetId/retry` | admin | Re-queue a failed ingestion |
| `POST /api/v1/admin/books/:bookId/withdraw` | admin | Withdraw a book (access stops) |
| `POST /api/v1/admin/books/:bookId/reinstate` | admin | Reinstate; **does not republish** the book |

Admins pass `publisherId` as a **query** parameter on the publisher asset
routes, like other book writes.

### Mobile reader

The mobile reader is being rebuilt in the next project to use this flow
(register device, download, decrypt with the licence). Until then the current
reader screen is not DRM-aware.

## Mobile

```sh
cd mobile
npm ci
npm start
```

The app expects the API at `http://localhost:3000/api/v1`
(`http://10.0.2.2:3000/api/v1` on the Android emulator); see
`mobile/src/config/api.ts`.

## Book lifecycle: archive, restore, delete

- Every publisher book payload carries `canDelete: boolean`, computed by the
  server with the same rules the delete route enforces.
- `status` can be `archived`. `GET /api/v1/publisher/books` hides archived
  books by default (`status=all`); `status=archived` returns only them.
  `GET /api/v1/publisher/stats` excludes archived books from `totalTitles` and
  `draftTitles` (sales totals are unchanged).
- `POST .../books/:id/archive` takes a title off sale for good while buyers keep
  reading it. `POST .../books/:id/restore` brings it back unpublished. Publishing
  an archived book is `409 BOOK_ARCHIVED`.
- `DELETE .../books/:id` (`204`) is only for a book that was never sold. Any
  sale, entitlement, library row or checkout history (including an abandoned
  checkout) blocks it with `409 BOOK_HAS_SALES`; archive instead. The other
  refusals are `403 FORBIDDEN` (withdrawn), `409 BOOK_PUBLISHED` and
  `409 ASSET_PROCESSING`. Stored files are removed after the commit, best
  effort.
- An archived book is read-only: `PATCH` on the book, cover `PUT`/`DELETE`, EPUB upload
  and asset activation all return `409 BOOK_ARCHIVED`. Restore is allowed.
- A checkout opened before a book was archived still completes if it is paid
  afterwards, and the buyer gets access (money was taken). A new checkout of an
  archived book is refused.
