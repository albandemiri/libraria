# Libraria reader website

Server-rendered React Router 7 storefront (TypeScript). Albanian by default,
English by cookie (`libraria_lang`) or `Accept-Language`. Design tokens come
from `../design`. Full documentation is in the root `README.md` (Website).

## Run

```sh
docker compose up --build            # from the repo root; http://localhost:5174
docker compose exec backend npm run seed:demo
```

Or on the host (the API must be on :3000):

```sh
cd ../design && npm ci && cd ../web
npm ci
npm run dev
```

## Environment

Copy `.env.example` to `.env` to override. `API_URL`, `SESSION_SECRET`
(`WEB_SESSION_SECRET` in the root compose), `PUBLIC_ORIGIN`, `PAYMENTS_MODE`
(`simulated` or `paddle`), `PADDLE_CLIENT_TOKEN`, `PADDLE_ENVIRONMENT`,
`PORTAL_URL`. All have development defaults.

## Using it

- Sign in at `/hyr` with any reader from `npm run seed:demo`, password
  `Password123!`.
- In simulated payments mode the checkout page `/pagesa/:transactionId` (where
  "Bli librin" leads) shows a development payment panel that plays Paddle's
  part with signed webhooks, so you can buy a book end to end. `/pagesa` itself
  is the Paddle checkout landing page.
- URLs: `/`, `/eksploro`, `/eksploro/:genre`, `/kerko`, `/botues/:id`,
  `/libri/:id/:slug?` (slug optional, redirects to the canonical one), `/hyr`,
  `/regjistrohu`, `/dil` (sign-out action, POST), `/pagesa`,
  `/pagesa/:transactionId`, `/biblioteka`, `/lista`, `/lexo/:id`.

## Scripts

`npm run dev`, `build`, `start`, `lint`, `typecheck`, `test`, `e2e`.

`npm run e2e` needs the Docker stack running with demo data. It uses
`/usr/bin/chromium` or `PLAYWRIGHT_CHROMIUM_PATH` and runs in English, because
headless Chromium may lack Albanian locale data.

## Not done yet

- The Paddle checkout path is **unverified** until a Paddle sandbox account
  exists.
- No Content-Security-Policy is set (a later hardening step; `/pagesa` will
  need Paddle's origins).
- Page counts exist only for books ingested after this change; reset the
  database and reload the demo data to see them locally.
- Audiobooks are not in the storefront.
