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
library ownership and the simulated checkout. These correspond to spec 13.1
scenarios 1 and 2. CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit
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

`PAYMENTS_MODE=simulated` completes checkout **without taking payment** and
exists for development only. The backend refuses to boot with it when
`NODE_ENV=production`, where the default is `disabled`. Real payments arrive
with the Commerce MVP (spec section 7), where entitlements are granted only
after a verified provider webhook.

## Mobile

```sh
cd mobile
npm ci
npm start
```

The app expects the API at `http://localhost:3000/api/v1`
(`http://10.0.2.2:3000/api/v1` on the Android emulator); see
`mobile/src/config/api.ts`.
