-- Publisher-uploaded covers: the re-encoded image and its thumbnail live in
-- object storage; the version busts caches whenever either changes.
ALTER TABLE books
  ADD COLUMN cover_object_key text,
  ADD COLUMN cover_thumb_key text,
  ADD COLUMN cover_version integer NOT NULL DEFAULT 0;
