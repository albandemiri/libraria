-- Libraria is an Albanian ebook marketplace: new books default to Albanian.
-- Existing rows keep their language; the API accepts 'sq' and 'en' for now.
ALTER TABLE books ALTER COLUMN language SET DEFAULT 'sq';
