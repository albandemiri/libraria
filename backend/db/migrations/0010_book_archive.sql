-- 0010: archiving. An archived book is off sale for good (is_available is cleared
-- together with this column) but stays readable by everyone who already owns it,
-- and every sale, statement and report is unchanged. Restoring clears the column.
ALTER TABLE books ADD COLUMN archived_at timestamptz;
