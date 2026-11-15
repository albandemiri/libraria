# Book Lifecycle Implementation Plan (archive, delete, easy unpublish)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishers can archive a title (it goes off sale for good and buyers keep access),
restore it, permanently delete a book that has never sold, and find Publish/Unpublish easily.

**Architecture:**
- **Backend.**
  - Status: a new `archived_at` column feeds `BOOK_STATUS_SQL`.
  - Routes: three new publisher routes in `publisher.ts`. Responses go through
    `loadPublisherBook`.
  - Deletability: one SQL expression gives both `canDelete` and the delete guard.
- **Portal.**
  - A `BookActions` component (header buttons plus a "More" menu) with three confirmation
    dialogs.
  - It is reused for the Catalog rows and cards.

**Tech Stack:**
- **Backend:** Express 5, zod 4, pg, node:test.
- **Portal:** React 19, TanStack Query, Radix (DropdownMenu or the existing Popover), i18next,
  Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-book-lifecycle-design.md`. Read it in full. The
redesign spec's "Checkpoint 1 rulings" also apply to the portal.

## Global Constraints

- **Status precedence:** withdrawn > archived > published > processing > ready > draft.
- **Archive:**
  - It sets `archived_at = now()` and `is_available = false` in one statement.
  - Archiving an already archived book returns 409 `BOOK_ARCHIVED`.
  - It is refused for a withdrawn book with 403 `FORBIDDEN`.
- **Publish while archived:** 409 `BOOK_ARCHIVED`.
- **Restore:** clears `archived_at` and **never** sets `is_available`.
- **Delete is refused with these codes, checked in this order:**
  1. withdrawn: 403 `FORBIDDEN`;
  2. published: 409 `BOOK_PUBLISHED`;
  3. processing asset: 409 `ASSET_PROCESSING`;
  4. any `transaction_items`, entitlements or `user_libraries` row: 409 `BOOK_HAS_SALES`.

  Otherwise it returns 204.
- **Delete transaction:**
  1. Lock the book.
  2. Null `current_asset_id`.
  3. Delete `book_assets`; the asset-level tables cascade.
  4. Delete the book.
  5. After the commit, delete the storage objects under `assets/{bookId}/`, `covers/{bookId}/`
     and the book's quarantine keys. This is best effort and logged.
- **`canDelete: boolean`** is on every publisher book payload and computed by the same rules.
- **Catalog filter:** the default (`all`) excludes archived books, and `status=archived` returns
  only archived ones.
- **Process:**
  - The migration is forward-only.
  - Errors use the standard shape.
  - Every code is mapped in en and sq.
  - Implementers never commit, stash or reset.
  - Portal tests run from PowerShell at `C:\Users\alban\IdeaProjects\libraria\portal`.

## Review Focus

1. **Deleting a book that has a buyer, under a race.** A purchase commits between the
   deletability check and the delete. The row lock plus `RESTRICT` must turn this into a clean
   409, never a 500 and never a lost sale. Test: the FK violation is mapped to `BOOK_HAS_SALES`.
2. **Archived book in checkout.** A new checkout of an archived book is refused, because
   commerce checks `is_available` (and re-checks it under a share lock when it creates the
   transaction). A checkout opened **before** the archive still completes: money was taken, so the
   buyer gets the book. Test both, and that `canDelete` is false afterwards.
3. **Buyers of an archived book.** They can still get a licence and download. Test it.
4. **Portal actions that don't match the server.** A stale `canDelete` or status shows a
   now-invalid action, and the server's 409 must show a translated message, not crash. Test it.
5. **Typing the title to confirm a Delete.** The match ignores surrounding spaces and is
   case-sensitive. The dialog's Delete button stays disabled until it matches. Test it.

---

### Task L-A: Backend

**Files:**
- **Create:** `backend/db/migrations/0010_book_archive.sql`,
  `backend/test/integration/book-lifecycle.test.ts`.
- **Modify:**
  - `backend/src/routes/publisher-books.ts`: status SQL, a `CAN_DELETE_SQL` column and the
    payload.
  - `backend/src/routes/publisher.ts`: the archive, restore and delete routes, the publish guard
    and the list filter.
  - The README publisher endpoints section.

**Interfaces (produced for Task L-B):**
- `POST /api/v1/publisher/books/:id/archive[?publisherId=]` returns `200 { book }`.
- `POST /api/v1/publisher/books/:id/restore[?publisherId=]` returns `200 { book }`.
- `DELETE /api/v1/publisher/books/:id[?publisherId=]` returns `204`.
- The book payload gains `status: 'archived'` and `canDelete: boolean`.
- `GET /publisher/books?status=archived` is accepted.

- [ ] **Step 1: Write the failing integration tests** in `book-lifecycle.test.ts`. They cover
  every rule in Global Constraints, Review Focus items 1–3, `canDelete` per case, isolation
  between publishers, and the admin `publisherId` path. For deletion, assert that the book's
  rows (`books`, `book_assets`, the wrapped key rows) and storage objects are gone.
- [ ] **Step 2: Run** `npm run test:integration -- test/integration/book-lifecycle.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the migration, the status and `canDelete` SQL, the routes and the
  guards. Map a foreign-key violation (`23503`) during the delete to 409 `BOOK_HAS_SALES`.
- [ ] **Step 4: Run** `npm test`, then `npm run test:integration` (alone), then
  `npm run typecheck`, `npm run lint` and `npm run build`. Expected: all PASS.

### Task L-B: Portal

**Files:**
- **Create:** `portal/src/components/BookActions.tsx` and its CSS,
  `portal/src/components/lifecycle.test.tsx`.
- **Modify:**
  - `api/books.ts`: add `useBookLifecycle(bookId)` with `archive`, `restore` and `remove`. All
    three invalidate `['books']`.
  - `api/types.ts`: add `archived` to `BookStatus`, and `canDelete`.
  - `BookPage.tsx`: the header actions, an archived notice and the read-only Edit.
  - `BookEditorPage.tsx`: read-only when archived.
  - `CatalogPage.tsx`: the row and card menus, the "All active" default and the "Archived"
    filter option.
  - `OverviewPage.tsx`: ignore archived books in the action items.
  - `DistributionPanel.tsx`: share the publish and unpublish logic with `BookActions`.
  - The status badge, i18n en and sq, and the existing tests whose expectations change.

**Interfaces:** consumes Task L-A's routes and payload fields. `BookActions({ book, variant:
'header' | 'menu' })`.

- [ ] **Step 1: Write the failing tests:**
  - Actions are shown or hidden by status and `canDelete`.
  - Each dialog: Unpublish confirms; Archive explains that buyers keep access; Delete needs the
    typed title (Review Focus 5).
  - After a delete, the app goes to `/catalog` with a notice.
  - A 409 from the server shows translated text and moves focus (Review Focus 4).
  - The Catalog defaults to all active books, and the Archived filter sends `status=archived`.
  - An archived book page is read-only.
  - axe.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint` and `npm run build`.
  Expected: all PASS.
