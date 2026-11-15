-- 0011: the delete guard and RESTRICT checks look up entitlements and library
-- rows by book; without these each check scans the whole table.
CREATE INDEX IF NOT EXISTS entitlements_book_idx ON entitlements (book_id);
CREATE INDEX IF NOT EXISTS user_libraries_book_idx ON user_libraries (book_id);
