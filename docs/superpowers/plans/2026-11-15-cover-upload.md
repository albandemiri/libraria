# Cover Upload Implementation Plan (redesign Task 8b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishers upload a cover image directly. The server re-encodes it with `sharp` and
makes a thumbnail. The "Cover URL" field is removed. The same task also fixes the inner padding
of the Overview list rows.

**Architecture:**
- **Synchronous processing in the API (approach A).** A raw-body route sits before
  `express.json()`, like the EPUB upload. A pure processing function `processCover(buf)` wraps
  `sharp`.
- **Storage.** Objects go under the existing `covers/` prefix. A migration adds the cover keys
  and a version to `books`.
- **Serving.** The public `GET /books/:id/cover` prefers the uploaded cover and falls back to
  the EPUB-extracted one.
- **Portal.** One `CoverPanel` component is used in the editor and on the book page.

**Tech Stack:**
- **Backend:** Node 24, Express 5, TS, zod 4, pg, `sharp` (new dependency, exact version
  pinned), and node:test via tsx.
- **Portal:** React 19, TanStack Query, i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-cover-upload-design.md`. Read it in full. The
redesign spec's "Checkpoint 1 rulings" also apply to the portal work.

## Global Constraints

- **Accepted input:** JPEG, PNG or WebP, at most **10 MB** (10 × 1024 × 1024 bytes). The type
  is decided by sharp's decoder, never by Content-Type or filename.
- **Decoder limits:** `limitInputPixels: 40_000_000` and `failOn: 'error'`. Width under
  **400 px** is rejected.
- **Main image:** auto-rotate, then strip all metadata, then sRGB JPEG at quality **85**. The
  long side is at most **2400 px**, using `withoutEnlargement`. Alpha is flattened on white
  (`#ffffff`).
- **Thumbnail:** **480 px** wide JPEG at quality 85, with the same processing.
- **Error codes:**
  - `COVER_TOO_LARGE` (413)
  - `COVER_UNSUPPORTED_TYPE` (415)
  - `COVER_TOO_SMALL` (422)
  - `COVER_INVALID` (422)
- **Object keys:** `covers/{bookId}/u-{uuid}.jpg` and `covers/{bookId}/u-{uuid}-thumb.jpg`.
- **Public URLs:**
  - `coverImageUrl` = `/api/v1/books/{id}/cover?v={cover_version}`
  - `coverThumbUrl` = `/api/v1/books/{id}/cover?size=thumb&v={cover_version}`, or null when
    there is no uploaded cover.
- **Precedence:** an uploaded cover wins. The EPUB cover is used only without an upload.
  DELETE falls back to the EPUB cover, then to none.
- **Process rules:**
  - Forward-only migration.
  - Standard error shape `{error:{code,message,requestId}}`.
  - Backend English never reaches the UI: map the codes in en and sq.
  - No git commits, stashes or resets by implementers.
  - Run the portal tests from PowerShell at `C:\Users\alban\IdeaProjects\libraria\portal`.

## Review Focus

1. **Decompression bombs:** a tiny PNG declaring 20000×20000 pixels must be refused with
   `COVER_INVALID` without allocating the decoded image. Test it in Task A.
2. **Body over 10 MB:** a declared `Content-Length` over 10 MB, or a chunked body that goes
   over the limit, gets 413 before the body is buffered. Reuse the EPUB raw-body limiter
   pattern. Test it in Task A.
3. **Concurrent uploads to one book:** the last commit wins, the version is strictly higher
   each time, and no orphaned object from the winning row is deleted. Delete the old keys read
   inside the same transaction. Test it in Task A.
4. **Cached cover after replace:** the browser must show the new cover, so the URL version
   changes on every upload and delete. Test this in Task A (API) and Task B (the preview `src`
   changes).
5. **A non-image renamed `.jpg`, an SVG with a script, a truncated JPEG:** each is refused
   with a translated message. Test the refusal in Task A and the mapping in Task B.

---

### Task A: Backend: processing, storage, routes, migration

**Files:**
- **Create:**
  - `backend/db/migrations/0009_book_cover_upload.sql`
  - `backend/src/covers/process-cover.ts`
  - `backend/src/covers/process-cover.test.ts`
  - `backend/src/routes/covers-publisher.ts`
  - `backend/test/integration/covers.test.ts`
- **Modify:**
  - `backend/package.json` (add `sharp`)
  - `backend/src/app.ts` (register the PUT before `express.json()`, next to the EPUB upload at
    line 38)
  - `backend/src/routes/publisher.ts` (mount DELETE; remove `coverImageUrl` from the create
    and patch schemas at line ~65; add `coverThumbUrl` to the book payloads)
  - `backend/src/routes/books.ts` (`GET /:id/cover` at lines ~193-218)
  - the books SELECTs that build `coverImageUrl` (books.ts, library.ts, commerce/queries.ts),
    only if `cover_image_url` stops being the stored public URL. Keep it stored, and update it
    in the same transaction.
  - README cover section.

**Interfaces:**
- **Produces, for Task B:**
  - `PUT /api/v1/publisher/books/:id/cover[?publisherId=]`. The body is the raw image. It
    returns `200 { book }`, with `book.coverImageUrl: string|null` and
    `book.coverThumbUrl: string|null`.
  - `DELETE /api/v1/publisher/books/:id/cover[?publisherId=]` returns `200 { book }`.
  - Every publisher book payload (list and detail) carries `coverThumbUrl`.
- **`processCover(input: Buffer): Promise<{ main: Buffer; thumb: Buffer; width: number; height: number }>`**
  - Throws `CoverError` with `code` set to one of the four codes above.
  - Size is checked by the route, not here.
- **Migration 0009:** adds to `books`:
  - `cover_object_key text NULL`
  - `cover_thumb_key text NULL`
  - `cover_version integer NOT NULL DEFAULT 0`

- [ ] **Step 1: Add `sharp`** at an exact version, released at least two weeks ago, to
  `backend/package.json`. Run `npm install`, then confirm it loads both on the host
  (`node -e "require('sharp')"`) and in the backend container
  (`docker compose exec backend node -e "require('sharp')"`). Keep the Docker check quick.

- [ ] **Step 2: Write the failing unit tests** in `process-cover.test.ts`. Generate the
  fixtures in-test with sharp itself.
  - `strips EXIF and GPS`: the input JPEG has EXIF with GPS; `sharp(main).metadata()` has no
    `exif` and no `xmp`.
  - `applies EXIF orientation`: an input with orientation 6 and size 600×900 gives an output
    of 900×600.
  - `flattens alpha on white`: a PNG with a transparent pixel gives an output whose pixel is
    (255,255,255).
  - `resizes the long side to 2400 and never enlarges`: 3000×4500 gives 1600×2400, and
    800×1200 stays 800×1200.
  - `thumbnail is 480 wide`.
  - `rejects under 400 px wide` throws `COVER_TOO_SMALL`.
  - `rejects pixel bomb`: a PNG header declaring 20000×20000 pixels throws `COVER_INVALID`.
  - `rejects SVG, GIF, text renamed jpg` throws `COVER_UNSUPPORTED_TYPE`. A non-image buffer
    may throw `COVER_INVALID` instead; assert one of the two per case, as pinned in the test.
  - `rejects truncated JPEG` throws `COVER_INVALID`.

- [ ] **Step 3: Run** `npm test -- src/covers/process-cover.test.ts`. Expected: FAIL (module
  missing).

- [ ] **Step 4: Implement `processCover`.**
  - Use `sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' })`.
  - Read the format from `metadata()` and accept only jpeg, png and webp.
  - Check that the width after rotation is at least 400.
  - Run `.rotate().flatten({ background: '#ffffff' }).toColourspace('srgb')`.
  - Produce two outputs: a resize with `fit: 'inside'` and `withoutEnlargement`, and a thumb
    of `width: 480`. Both go through `.jpeg({ quality: 85 })`. Never call `withMetadata()`.
  - Wrap sharp errors as `COVER_INVALID`.
  - Run sharp work through a small concurrency limit of 2.

- [ ] **Step 5: Run** the unit tests. Expected: PASS.

- [ ] **Step 6: Write the failing integration tests** in `covers.test.ts`, using
  `test/integration/harness.ts` the same way `asset-delivery.test.ts` uses it.
  - A publisher uploads a cover to their own book and gets 200, `coverImageUrl` ends with
    `?v=1`, and `coverThumbUrl` is set.
  - `GET /books/:id/cover` returns `image/jpeg` with `nosniff`. `?size=thumb` returns an
    image 480 wide.
  - Uploading to another publisher's book gives 404 `NOT_FOUND`.
  - An admin without `publisherId` is rejected, the same way the other publisher routes
    reject it.
  - Uploading to a withdrawn book gives 403 `FORBIDDEN`, the same code the publish route uses
    for withdrawn books.
  - A declared Content-Length of 10 MB + 1 gives 413 `COVER_TOO_LARGE`, without reading the
    body.
  - A second upload gives `?v=2`, and the first upload's objects are gone from storage.
  - Two parallel uploads both succeed, the final version is 2 or more, and the stored keys
    exist.
  - DELETE on a book whose current asset has an extracted cover makes `coverImageUrl` point
    to the cover route with the version bumped. GET then serves the EPUB cover, and
    `coverThumbUrl` is null.
  - DELETE on a book with no EPUB cover makes `coverImageUrl` null.
  - An EPUB processed after an upload keeps the uploaded cover. The worker rule is unchanged;
    assert it holds.
  - Sending `coverImageUrl` in the PATCH body gives 400 `VALIDATION_FAILED`.

- [ ] **Step 7: Run** `npm run test:integration -- test/integration/covers.test.ts`.
  Expected: FAIL.

- [ ] **Step 8: Implement the migration and the routes.**
  - The PUT handler chain is: auth, role, rate limit (`name: 'cover-upload'`, 60 per hour,
    keyed like the asset upload), scope guard (with the withdrawn check), the raw body
    limiter (10 MB, only image types or `application/octet-stream` reach processing),
    `processCover`, then the put of both objects.
  - In one transaction it locks the book row `FOR UPDATE`, reads the old keys, sets the new
    keys, `cover_version = cover_version + 1` and `cover_image_url`, and commits. After the
    commit it deletes the old objects, best effort and logged.
  - DELETE does the same with null keys. `cover_image_url` becomes the versioned cover route
    if the current asset has an extracted cover, otherwise null.
  - `GET /:id/cover` serves `cover_thumb_key` or `cover_object_key` when set, otherwise the
    current asset's extracted cover, which is also what `?size=thumb` falls back to.
  - Factor the EPUB raw-body limiter into a reusable `rawBodyWithLimit(maxBytes, types,
    tooLargeCode)` rather than copying it.

- [ ] **Step 9: Run** `npm test`, `npm run test:integration`, `npm run typecheck` and
  `npm run lint`. Expected: all PASS, with the existing tests unchanged.

- [ ] **Step 10: Commit,** only if authorised: `feat(covers): cover image upload with
  server-side re-encoding`.

---

### Task B: Portal: cover panel, remove the URL field, thumbnails, Overview padding

**Files:**
- **Create:**
  - `portal/src/components/CoverPanel.tsx`
  - `portal/src/components/CoverPanel.module.css`
  - `portal/src/components/cover.test.tsx`
- **Modify:**
  - `portal/src/api/books.ts` (add `useCoverMutations(bookId)` with `upload(file: File)` and
    `remove()`; both invalidate `['books']`)
  - `portal/src/api/types.ts` (`Book.coverThumbUrl: string | null`)
  - `portal/src/pages/BookEditorPage.tsx` (remove the Cover URL field and its validation;
    mount `CoverPanel` in the Files section once the draft exists)
  - `portal/src/pages/BookPage.tsx` (Files & DRM tab: `CoverPanel` above the asset panel)
  - `portal/src/pages/CatalogPage.tsx` and `portal/src/pages/OverviewPage.tsx` (use
    `coverThumbUrl ?? coverImageUrl` for small covers)
  - `portal/src/pages/Page.module.css`, or the Overview list styles (row padding)
  - `portal/src/i18n/en.json` and `portal/src/i18n/sq.json`
  - the existing tests that typed into the Cover URL field

**Interfaces:**
- **Consumes:** Task A's PUT and DELETE responses and `coverThumbUrl`.
- **Produces:** `CoverPanel({ book }: { book: Book })`.

- [ ] **Step 1: Write the failing tests** in `cover.test.tsx`, with fetch stubbed.
  - **Upload:** drop a `image/png` File and a PUT is sent with that `Content-Type` and the
    raw body. The admin `publisherId` is in the query. The preview `img` `src` changes from
    `?v=1` to `?v=2`.
  - **Client checks:** a 10 MB + 1 file, or `image/gif`, shows the translated message, sends
    no request, and focuses the message.
  - **Low-resolution warning:** a 1000×1500 image shows the soft warning, which is not a
    refusal. Stub `createImageBitmap`, or read the `Image` natural size through a helper you
    can mock.
  - **Server errors:** each of the four codes maps to its own en text and its own sq text.
  - **Remove:** a confirm, then a DELETE is sent, and the preview falls back.
  - **Editor:** the editor has no "Cover URL" field. The panel is absent before the draft
    exists and present after it.
  - **Catalog grid:** it uses `coverThumbUrl` when present.
  - **Overview:** the top books, activity and action rows have inner horizontal padding of at
    least `var(--s-4)`. Assert the class is applied, and check by eye at the checkpoint.
  - **axe:** passes on the panel in the empty, with-cover and error states.

- [ ] **Step 2: Run** `npx vitest run src/components/cover.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `CoverPanel` contains:
    - a `FileDrop` with accept `image/jpeg,image/png,image/webp` and a hint giving the 2:3
      ratio, 1600 × 2400, and JPEG/PNG/WebP up to 10 MB;
    - a `BookCover` preview;
    - Replace and Remove buttons, with Remove going through a `Dialog` confirm;
    - a `Notice` for errors.
  - Overview list rows get `padding-inline: var(--s-4)`, with the same padding on the
    empty-state cards. Top books, activity and action items all use it.

- [ ] **Step 4: Run** `npx vitest run`, `npm run typecheck`, `npm run lint` and
  `npm run build`. Expected: all PASS.

- [ ] **Step 5: Commit,** only if authorised: `feat(portal): cover upload panel and thumbnails`.
