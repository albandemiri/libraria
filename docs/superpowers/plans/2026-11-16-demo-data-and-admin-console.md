# Demo Data and Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- A deterministic Albanian demo marketplace (`npm run seed:demo`).
- A printable list of questions for publishers.
- An admin console inside the portal: publishers, invite-link onboarding, contracts, books
  across publishers, readers, and platform-wide figures.

**Architecture:**
- **Backend.**
  - New admin routes in `routes/admin.ts`, split into focused files where it helps:
    `admin-publishers.ts`, `admin-reports.ts`, `admin-readers.ts`.
  - Public invite routes in `routes/auth.ts`.
  - One migration.
  - Platform figures reuse `salesBase` and `METRICS_SQL` without the publisher filter.
- **Portal.** A *Platform* sidebar group, shown to admins only, plus a public `/invite` page.
  Everything is built from the existing `ui/` components.
- **Demo seed.** A script that drives the real commerce, cover and asset paths, then backdates
  the timestamps.

**Tech Stack:**
- **Backend:** Node 24, Express 5, zod 4, pg, sharp, node:test.
- **Portal:** React 19, TanStack Query, React Router 7, i18next, Vitest, vitest-axe.

**Spec:** `docs/superpowers/specs/2026-11-16-demo-data-and-admin-console-design.md`. Read it in
full, including "One account per email" and "Answers and calls". The portal redesign spec's
"Checkpoint 1 rulings" also apply.

## Global Constraints

- **Demo seed safety.** `seed:demo` refuses when `NODE_ENV=production`. If demo publishers
  already exist, it stops without deleting anything, and its message tells the user how to
  reset the database. Its output is deterministic: a fixed random seed and fixed UUIDs.
- **Invite token.**
  - 32 random bytes, sent base64url in the link only.
  - Stored as SHA-256 (`token_hash bytea`).
  - Valid for 7 days, single use.
  - The link format is `{PORTAL_ORIGIN}/invite#token=…`.
- **Invite errors.**
  - `410 INVITE_INVALID`, with `details.reason` set to `expired`, `used`, `revoked` or
    `unknown`.
  - `409 EMAIL_TAKEN` when the email already has an account.
- **`PORTAL_ORIGIN`.** Defaults to `http://localhost:5173` outside production and is required
  in production. Env validation must fail without it in production.
- **Admin access.** Every `/admin/*` route requires the admin role. Every portal Platform route
  gives a publisher account "not found".
- **Platform totals.** They come from the same `salesBase`/`METRICS_SQL` as the publisher
  reports. The per-publisher rows must sum exactly to the platform totals.
- **Reader lookup.**
  - A prefix needs at least 3 characters; an exact email always works.
  - At most 20 results.
  - Opening a reader's page writes the audit entry `reader.viewed`.
- **Audit entries.** `invite.created`, `invite.revoked`, `invite.accepted`,
  `publisher.created`, `publisher.updated`. Use the existing `audit()` helper.
- **Process.**
  - Forward-only migrations.
  - en and sq keys identical, with natural Albanian.
  - No git state changes by implementers.
  - Portal tests run from PowerShell at `C:\Users\alban\IdeaProjects\libraria\portal`.
  - Backend integration tests always run alone, never two copies at once.

## Review Focus

1. **Invite replay and races.** Two accepts of one token at the same moment: exactly one
   creates the user and the other gets `410 used`. Test this with two connections, the way the
   book-lifecycle race test does.
2. **Token leakage.**
   - The token must never appear in any log line, server URL, response other than the create
     response, or the audit metadata.
   - The accept page must remove the fragment from the URL after reading it
     (`history.replaceState`).
   - Test the request log and the audit row for the token.
3. **Platform figures.** For a period with a partial refund and an unsplit (no-rate) sale, the
   platform totals equal the sum of the per-publisher rows, and each row equals that
   publisher's own `/publisher/reports/summary`. Test it.
4. **An admin action against a missing or foreign id.** Unknown publisher, user or book ids
   give a clean 404, never a 500. A publisher account gets 403 on every admin route. Test it
   across all the new routes.
5. **Hand-edited Platform URLs and stale data.**
   - Bad `?publisher=` or `?status=` values fall back to defaults.
   - A cancelled invite's link shows "revoked", not a crash.
   - A suspended invitee who accepted cannot sign in.
   - Test it.

---

### Task 1: Demo seed

**Files:**
- Create: `backend/src/db/seed-demo.ts`, `backend/src/db/demo-data.ts` (the invented content
  and a deterministic generator), `backend/src/db/demo-data.test.ts`.
- Modify: `backend/package.json` (`"seed:demo": "tsx src/db/seed-demo.ts"`), README (Quick
  start: how to load and reset the demo).

**Interfaces:**
- `buildDemoPlan(seed: number): DemoPlan` in `demo-data.ts`. It is a pure function covering
  the publishers, books, readers and order schedule, with refund flags and countries.
- `seed-demo.ts` turns the plan into data through the real paths:
  - publishers and rates through SQL that matches the admin routes;
  - books through the publisher insert;
  - EPUBs through `buildSampleEpub` and `ingestNow`, the same way `seed.ts` does it;
  - covers through `processCover` and the cover write path;
  - purchases through `createCheckout` and the sandbox completion event;
  - refunds through the sandbox refund event (full and partial);
  - then the timestamps are backdated.

**Steps:**
- [ ] **Step 1: Write the failing unit tests** in `demo-data.test.ts`:
  - the same seed gives a deep-equal plan;
  - 3–4 publishers, each with 15–20 books;
  - every country is from the weighted list;
  - about 3% full refunds and exactly one partial refund;
  - every order date is within the last 6 months;
  - the trend rises (the sales count in the last month is greater than in the first);
  - no publisher name equals one on a real-publisher denylist kept in the test (Onufri,
    Toena, Dudaj, Pegi, Fan Noli, Ombra GVG, Botimet IDK).
- [ ] **Step 2: Run** `npm test -- src/db/demo-data.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildDemoPlan` and `seed-demo.ts`.
  - **Covers:** render each cover to a JPEG in a child process or by any method that keeps
    `sharp.block` intact in the cover module. Then pass it through `processCover`.
  - **Production guard:** refuse when `NODE_ENV=production`.
  - **Re-runs:** stop when the demo publishers already exist.
- [ ] **Step 4: Run it for real** against the dev database, running
  `docker compose exec backend npm run seed:demo`, then a second time.
  - Expected: the first run prints the logins. The second run prints "already loaded" and
    changes nothing.
  - Spot-check with SQL: the counts, `paid_at` spread over 6 months, refunds present, covers
    present.
- [ ] **Step 5: Run** `npm test`, `npm run test:integration` (alone), `typecheck`, `lint` and
  `build`. Expected: all PASS.

### Task 2: Questions for publishers (controller writes it)

**Files:** create `docs/business/publisher-questions.md`, following the spec's Part 1b topics.
Each question has a one-line "why we ask" and an answer line. No code.

### Task 3: Admin and invite API

**Files:**
- **Create:**
  - `backend/db/migrations/0013_admin_console.sql`: `publishers.country char(2)` and
    `publisher_invites` with its partial unique index.
  - `backend/src/routes/admin-publishers.ts`
  - `backend/src/routes/admin-reports.ts`
  - `backend/src/routes/admin-readers.ts`
  - `backend/src/auth/invites.ts` (token create, hash, inspect, accept)
  - `backend/test/integration/admin-console.test.ts`
- **Modify:**
  - `backend/src/routes/admin.ts`: mount the new routers and add `GET /admin/books`.
  - `backend/src/routes/auth.ts`: `POST /auth/invites/inspect` and
    `POST /auth/invites/accept`, both rate-limited. Accept reuses `passwordSchema`,
    `sessionCookie` and `publicUser`.
  - `backend/src/config/env.ts`: `PORTAL_ORIGIN`.
  - `backend/src/middleware/errors.ts`: the codes.
  - The README admin and env sections.

**Interfaces (produced for Tasks 4 and 5):**

| Route | Request | Response |
|---|---|---|
| `GET /admin/publishers` | `?q` | `{ publishers: [{ id, name, country, contactEmail, currentRateBps \| null, bookCount }] }` (extends the existing list; the portal picker keeps working) |
| `POST /admin/publishers` | `{ name, contactEmail, country }` | `201 { publisher }` |
| `PATCH /admin/publishers/:id` | same fields, optional | `{ publisher }` |
| `GET /admin/publishers/:id` | | `{ publisher, team: [{ id, email, displayName, status, createdAt }], invites: [{ id, email, displayName, createdAt, expiresAt }] }`, where invites are the open, unexpired ones |
| `POST /admin/publishers/:id/invites` | `{ email, displayName? }` | `201 { invite, link }`, the link shown once; an existing open invite for the pair is revoked first |
| `DELETE /admin/invites/:id` | | `204` (revoke) |
| `POST /auth/invites/inspect` | `{ token }` | `{ email, publisherName, displayName }` or `410` |
| `POST /auth/invites/accept` | `{ token, password, displayName }` | `{ user }`, with the portal cookie set |
| `GET /admin/reports/summary` | `?from&to&granularity` | the same shape as the publisher summary, platform-wide |
| `GET /admin/reports/by-publisher` | `?from&to` | `{ rows: [{ publisherId, publisherName, ...Metrics }] }` |
| `GET /admin/books` | `?q&publisherId&status&sort&order&page&limit` | the publisher book payload plus `publisherName` |
| `GET /admin/readers` | `?q` | `{ readers: [{ id, email, displayName, status, createdAt }] }` |
| `GET /admin/readers/:id` | | `{ reader, booksOwned, devices: [...], removalsThisYear }` |

**Steps:**
- [ ] **Step 1: Write the failing integration tests:**
  - every interface row above;
  - Review Focus items 1–5;
  - an expired invite, a revoked invite and `EMAIL_TAKEN` for a reader's email;
  - the audit entries written;
  - `reader.viewed` written.
- [ ] **Step 2: Run** the new test file alone. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, `npm run test:integration` (alone), `typecheck`, `lint` and
  `build`. Expected: all PASS.

### Task 4: Portal: Platform shell, Overview, Publishers and the invite page

**Files:**
- **Create:**
  - `portal/src/pages/platform/PlatformOverviewPage.tsx`
  - `PublishersPage.tsx`
  - `PublisherPage.tsx` (tabs: Details, Team, Contract, Books)
  - `PublisherForm.tsx`
  - `portal/src/pages/InvitePage.tsx` (public)
  - `portal/src/api/admin.ts`
  - tests `platform.test.tsx` and `invite.test.tsx`
- **Modify:** `layout/navItems.ts` (the Platform group, admins only), `AppRoutes.tsx`
  (`/platform/*` behind an admin guard, public `/invite`), and the i18n files.

**Interfaces:** consumes Task 3. `useAdminPublishers`, `useAdminPublisher(id)`,
`useInviteActions(publisherId)`, `usePlatformSummary(range)`, `usePlatformByPublisher(range)`.

**Steps:**
- [ ] **Step 1: Write the failing tests:**
  - the Platform group is shown for admins and hidden for publishers;
  - `/platform/*` gives "not found" for a publisher;
  - Overview figures equal the fixture, and the by-publisher table links to each publisher;
  - creating a publisher validates and creates;
  - the invite flow shows the link once, with copy to the clipboard, and cancel and re-issue
    work;
  - the Team tab can suspend and reactivate;
  - Contract "Add rate" works;
  - `/invite#token=…`:
    - reads the token, then clears the hash;
    - shows the publisher and email;
    - a mismatched password confirmation is refused;
    - accept signs the person in and redirects to `/`;
    - each 410 reason shows its own message;
    - `EMAIL_TAKEN` shows the "use another email" text;
  - axe passes on every new page.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint` and
  `npm run build`. Expected: all PASS.

### Task 5: Portal: Platform Books and Readers

**Files:**
- **Create:** `portal/src/pages/platform/PlatformBooksPage.tsx`, `ReadersPage.tsx`,
  `ReaderPage.tsx`, and the test `platform-support.test.tsx`.
- **Modify:** `api/admin.ts`, the i18n files.

**Steps:**
- [ ] **Step 1: Write the failing tests:**
  - **Books:**
    - search, publisher and status filters sync with the URL, including garbage values;
    - withdraw needs a reason and the confirm warns that buyers lose access;
    - reinstate works.
  - **Readers:**
    - a 2-character query sends no request and shows a hint;
    - results link to the reader page;
    - suspend and reactivate work, device removal asks for confirmation, and the removals
      reset works.
  - axe passes.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint` and
  `npm run build`. Expected: all PASS.
