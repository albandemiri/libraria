# Cover image upload: design

Date: 2026-11-15. Status: draft for approval. Part of the portal redesign branch
(`phase-5/portal-redesign`). It is built before redesign Task 9, so the cleanup, README and
full verification cover it.

## Why

Publishers can't upload a cover today. They can only paste a link to an image hosted
elsewhere, or rely on the server pulling the cover out of the EPUB. The user expects uploading
to be **the main way covers get into Libraria**.

## Decisions (the user's)

- **Upload is the primary path.** The book editor and the book page get a cover upload with
  a preview.
- **The "Cover URL" field is removed.** External links can break or change without notice,
  and they tell third-party servers who is viewing the books (readers included).
- **Approach A:** the image is processed synchronously in the API on upload, so the
  publisher sees the result immediately.

## Approaches considered

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| A | Process on upload in the API with `sharp` (re-encode, strip metadata, thumbnail) and return the result | Instant preview. The image is decoded in the API process, so it needs a size cap and a pixel limit | **Chosen** |
| B | Queue it through the EPUB worker (scan, then process) and poll | Most isolation, but more moving parts and a delayed preview for small, simple files | Rejected |
| C | Store the bytes as uploaded after a type check | Simplest, but metadata such as GPS stays in the file, there's no thumbnail, and huge images reach phones | Rejected |

## Behaviour

**Precedence:** an uploaded cover always wins. The EPUB-extracted cover is used only when
nothing has been uploaded. Removing the uploaded cover falls back to the EPUB cover if there
is one, otherwise to no cover.

**Accepted input:**
- JPEG, PNG or WebP, up to **10 MB**.
- The type is decided by `sharp`'s decoder (magic bytes), not by the Content-Type or the
  filename. SVG, GIF, HEIC and anything else are rejected.
- The input pixel limit is about **40 megapixels** (`limitInputPixels`). Decoding fails on
  error (`failOn: 'error'`), so a truncated or corrupt file is rejected rather than half
  rendered.
- Minimum width: **400 px** (smaller is rejected).

**Output (my calls):**
- The image is auto-rotated from its EXIF orientation, then **all metadata is stripped**.
- Both outputs are JPEG at quality 85, sRGB. Transparency is flattened onto white.
- The **main cover** is no more than 2400 px on its long side, and is never enlarged.
- A **thumbnail** is made at 480 px wide for the catalog grid and lists.
- The aspect ratio is not enforced. The UI recommends 2:3 (for example 1600 × 2400) and shows
  a soft warning below 1400 px wide ("may look soft on large screens"). This is not a
  rejection.

**Storage:**
- New objects go to `covers/{bookId}/u-{uuid}.jpg` and `covers/{bookId}/u-{uuid}-thumb.jpg`.
  The existing `covers/` key prefix and storage adapter are reused.
- The old uploaded objects are deleted after the database update commits. This is best
  effort, and a failure is logged rather than surfaced.

## API

- **`PUT /api/v1/publisher/books/:id/cover`**
  - The raw image is the request body, the same pattern as EPUB upload (`express.raw` with
    a hard limit on this route only).
  - `?publisherId=` is required for admins, as on the other publisher routes, and the
    publisher's scope is checked.
  - Refused for withdrawn books.
  - Rate-limited like the asset upload.
  - Returns the updated book (`coverImageUrl`, `coverThumbUrl`).
  - Errors use the standard error shape with stable codes: `COVER_TOO_LARGE` (413),
    `COVER_UNSUPPORTED_TYPE` (415), `COVER_TOO_SMALL` (422) and `COVER_INVALID` (422,
    covering undecodable files and the pixel limit).
- **`DELETE /api/v1/publisher/books/:id/cover`**
  - Removes the uploaded cover and falls back as described under Precedence.
- **`GET /api/v1/books/:id/cover`** (existing, public)
  - Serves the uploaded cover if there is one, otherwise the EPUB-extracted cover.
  - `?size=thumb` serves the thumbnail. EPUB covers have no thumbnail, so they fall back to
    the full image.
  - `coverImageUrl` carries a version, `/api/v1/books/{id}/cover?v={n}`, so the existing
    one-day cache is busted when the cover changes.
  - `nosniff` and the `Content-Type` sniffed from the stored bytes are kept.
- **Removing the link field:** `coverImageUrl` is removed from the publisher create and
  update schemas. Sending it gets the usual validation error. `books.cover_image_url` stays
  as the server-computed public URL. Existing external URLs in development data are left in
  place and simply can't be set any more.

## Data

Migration `0009_book_cover_upload.sql` adds the following to `books`:
- `cover_object_key text NULL`
- `cover_thumb_key text NULL`
- `cover_version integer NOT NULL DEFAULT 0`

The upload and the delete update these and `cover_image_url` in one transaction.

An uploaded cover (`cover_object_key` set) is never overwritten by an EPUB. When nothing was
uploaded, the EPUB's cover is what shows, and the URL is versioned (`?v=n`) so caches refetch:

- **Worker** (`completeAsset`): when an asset goes live (the book's first ready asset) and it has
  an EPUB cover, the URL is set to the versioned cover path. This replaces a legacy external
  URL, which is no longer shown once an EPUB with a cover goes live.
- **Activation** (`activateAsset`, also a rollback): with nothing uploaded, it recomputes and
  versions the URL from the newly live asset, and clears the URL when that asset has no cover.
- With an uploaded cover, neither the worker nor activation touches the cover columns.

## Portal

- **Placement:** a "Cover" block in the editor's Files section and on the book page's
  "Files & DRM" tab. It sits in the editor's Files section because the Cover URL field
  lived there.
- **The block:**
  - `FileDrop` for `image/jpeg,image/png,image/webp`, and a preview using `BookCover`.
  - Replace and Remove actions.
  - The 2:3 and size hint, plus the soft low-resolution warning, worked out from the image's
    natural size before upload.
- **Before upload:** the type and the 10 MB cap are checked in the browser, so the publisher
  gets a fast message. The server stays the authority.
- **Errors:** every error code maps to translated text (en and sq), never backend English.
  Focus moves to the error. On success the book queries are invalidated.
- **Thumbnails:** the catalog grid, the tables, Overview's top books and the activity list
  use `coverThumbUrl` when it is present.
- **Upload timing:** on a new book, the cover can be uploaded once the draft exists, the
  same as the EPUB.

## Non-goals

- Cropping or editing in the browser.
- Several images per book.
- Re-processing EPUB-extracted covers through `sharp`, or making thumbnails for them.
- Virus scanning images. Re-encoding through `sharp` already discards anything that isn't
  pixels.

## Testing

**Backend unit tests (the processing function):**
- EXIF and GPS are stripped from the output.
- A PNG with alpha is flattened.
- A file over the pixel limit is rejected, using a small file with huge declared
  dimensions.
- An SVG, a GIF, a text file renamed `.jpg`, and a truncated JPEG are rejected.
- A file under 400 px is rejected.
- A large image is resized to the 2400 px long side, and a small one is not enlarged.

**Backend integration tests:**
- A publisher can't upload to another publisher's book.
- An admin needs `publisherId`.
- Uploading to a withdrawn book is refused.
- A request over 10 MB gets 413 before the body is buffered.
- The version increments.
- `GET /cover` serves the uploaded cover, then the EPUB fallback after a delete.
- An EPUB processed after an upload doesn't override the uploaded cover.
- The old objects are deleted.

**Portal tests:**
- Upload, preview and remove.
- The client-side type and size messages.
- The mapping of each error code in en and sq.
- Focus moves to the error.
- Thumbnail URLs are used in the grid.
- axe.

## Left to the builder

- The exact code layout, for example `src/covers/` versus `src/drm/`.
- Whether `sharp` work runs inside a concurrency limit. A small semaphore is recommended.
- How the version is passed through in the existing books queries.

## Review rulings (2026-11-15, security review of Task A)

- Magic-byte check (JPEG/PNG/WebP) before any sharp call; unused libvips loaders blocked with `sharp.block`.
- Thumbnail derived from the main output, bounded to 480×720 (`fit: inside`, never enlarged).
- Extreme shapes (long side > 3× short side) are rejected with `COVER_BAD_SHAPE` (422).
- Cover processing queue: 2 running, 8 waiting; beyond that 503 `COVER_BUSY` with `Retry-After`.
- EPUB-derived cover URLs are versioned too (worker completion and asset activation bump `cover_version`).
- Orphaned `covers/*/u-*` objects after a crash are not swept yet (documented, later).
