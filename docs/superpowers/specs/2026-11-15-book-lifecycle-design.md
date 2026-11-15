# Book lifecycle: delete, archive, easy unpublish

Date: 2026-11-15. Status: draft for approval. Branch: `phase-5/portal-redesign`. This is built
before the redesign is committed.

## Why

Publishers need a way to remove a listing. The user wants two cases:

- **Clean up mistakes.** Drafts and test books are removed for good.
- **Take a title off sale for good,** for example when the licence ends. Readers who bought it
  **keep reading it** (user's decision, matching Kindle and Apple Books).

Unpublish already exists, but it is buried in the Distribution tab. Until the final fix round
it was also broken on the book page. It has to be easy to find.

## What exists today (facts)

- **Unpublish** (`POST /publisher/books/:id/unpublish`) sets `is_available = false`. The book
  leaves the storefront and checkout, and buyers keep access.
- **Admin withdraw** is a takedown: `withdrawn_at` is set, and licences and downloads are refused,
  so buyers lose access. It stays admin-only and is unchanged.
- **Sales history is protected by the database.** Every table that points at `books` uses
  `ON DELETE RESTRICT`: the libraries, the ledger items, entitlements and assets. The
  asset-level tables cascade from `book_assets`.

## Approaches

There is one sensible way, chosen within the user's decisions above.

- **Hard-delete everything:** rejected, because it destroys buyers' access and the publisher's
  reports.
- **Soft-delete every book:** rejected, because drafts that never sold would pile up forever.
- **Chosen:**
  - a real delete, only for books that have never been sold;
  - an archive state for books that have been sold.

## Behaviour

**Statuses**
- New status `archived`, derived in `BOOK_STATUS_SQL` from a new `archived_at` column.
- Precedence: withdrawn > archived > published > processing > ready > draft.

**Archive.** Allowed for any book that isn't withdrawn, sold or not.
- It sets `archived_at = now()` and `is_available = false` in one statement. The book goes off
  sale at the same moment.
- Buyers keep reading, and reports, statements and CSVs are unchanged.
- An archived book **cannot be published.** That returns `409 BOOK_ARCHIVED`; restore it first.
- Archiving an already archived book returns `409 BOOK_ARCHIVED`.

**Checkout opened before an archive.** A new checkout of an archived book is refused. A checkout
opened while the book was on sale still completes if it is paid afterwards, and the buyer gets
access: money was taken, so that is the safe side. The book then has a sale, so it cannot be
deleted. Checkout also re-checks `is_available` under a share lock when it creates the
transaction, so an unpublish, archive or delete that lands in between gives a clean 404.

**Read-only on the server.** An archived book refuses edits (PATCH), cover upload and removal, EPUB upload and asset activation with `409 BOOK_ARCHIVED`. Restore stays allowed.

**Restore.** It clears `archived_at`. The book stays off sale (it becomes ready or draft) until
it is published again. This is my call: restoring never silently puts a book back on sale.

**Delete.** Only when **all** of these hold:
- the book is not published (`is_available = false`);
- it is not withdrawn;
- no asset is currently processing;
- **no rows exist** in the ledger items, entitlements or readers' libraries for it.

Otherwise:
- `409 BOOK_HAS_SALES` (the message suggests archiving);
- `409 BOOK_PUBLISHED` (unpublish first);
- `409 ASSET_PROCESSING`;
- `403 FORBIDDEN` for withdrawn books.

It runs in one transaction with the book row locked:
1. Clear `current_asset_id`.
2. Delete the `book_assets` rows. The keys, licences, grants and jobs cascade.
3. Delete the book.
4. After the commit, delete its stored objects, best effort and logged: `assets/{id}/…`,
   `covers/{id}/…` and any quarantine leftovers. Destroying the wrapped keys makes any missed
   ciphertext unreadable anyway.

The database's `RESTRICT` constraints stay as the final safety net.

**`canDelete`.** Every publisher book payload gets `canDelete: boolean`, computed by the server
with the same rules. The portal shows Delete only when it is true, and shows the reason when it
isn't.

**Admins.** The same routes work with `?publisherId=`, scoped like the other publisher routes.

## API

| Route | Effect |
|---|---|
| `POST /publisher/books/:id/archive` | archive (off sale for good, buyers keep access) |
| `POST /publisher/books/:id/restore` | un-archive, stays unpublished |
| `DELETE /publisher/books/:id` | permanent delete, never-sold books only |

All return the standard book payload through `loadPublisherBook`. The DELETE returns `204`.

Migration `0010_book_archive.sql` adds `books.archived_at timestamptz NULL`.

## Portal

**Book page header.** It gets the primary Publish/Unpublish button next to Edit, plus a "More"
menu containing:
- Archive or Restore;
- Delete, shown only when `canDelete` is true.

**Catalog.** Each row (table) and card (grid) gets a small actions menu with the same actions.

**Default Catalog list.** It **hides archived books**:
- the status filter's default is "All active";
- a new "Archived" option shows only archived books;
- Overview's needs-attention list ignores archived books.

**Confirmations**
- **Unpublish:** a simple confirm. Off sale now, buyers keep reading.
- **Archive:** a confirm that explains the book goes off sale for good, buyers keep their copies,
  reports are kept, and it can be restored later.
- **Delete:** a confirm that says it is permanent and **requires typing the book's title.** This
  is my call, for a permanent action.

**After an action**
- **After Delete:** go to the Catalog with a success notice.
- **Errors:** each error code maps to translated text. Focus moves to the message.
- **Queries:** invalidate the book queries after every action.

**Archived books are read-only.** Their pages show an "Archived" badge and a short explanation.
The editor is read-only for them, so a Restore is needed before editing (my call).

## Non-goals

- Publishers removing access for existing buyers. Admin withdraw stays the only takedown.
- A trash or undo for Delete. The typed-title confirmation is the safeguard.
- Bulk actions.

## Testing

**Backend integration**
- Archive takes a book off sale and buyers can still get licences.
- Publish is refused while the book is archived.
- Restore keeps the book unpublished.
- Delete:
  - it is refused for a sold book, a published book, a withdrawn book and a processing book;
  - deleting a draft that has a ready EPUB and an uploaded cover removes its rows and objects;
  - one publisher cannot delete another publisher's book;
  - the admin `publisherId` path works.
- `canDelete` is correct in each of those cases.
- Archived books are excluded by the default catalogue filter and included by `status=archived`.

**Portal**
- The header and row actions are shown and hidden by status and by `canDelete`.
- Each confirmation dialog works, including typing the title before Delete.
- Error codes are mapped in en and sq.
- Focus behaves correctly.
- The Catalog defaults to hiding archived books.
- axe checks pass.
