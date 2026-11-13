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
<http://localhost:3000>. Check it with `curl http://localhost:3000/health`.

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

### Backend scripts

| Script                     | Purpose                                                    |
| -------------------------- | ---------------------------------------------------------- |
| `npm run dev`              | API with hot reload                                        |
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

## Mobile

```sh
cd mobile
npm ci
npm start
```

The app expects the API at `http://localhost:3000/api/v1`
(`http://10.0.2.2:3000/api/v1` on the Android emulator); see
`mobile/src/config/api.ts`.
