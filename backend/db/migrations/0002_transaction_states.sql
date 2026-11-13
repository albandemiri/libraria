-- 0002: full transaction state model (spec Appendix A, 16.1).
--
-- Kept separate from 0003 because PostgreSQL does not allow a newly added
-- enum value to be used in the same transaction that adds it.

-- "completed" meant "money taken and book granted"; the spec calls that paid.
ALTER TYPE transaction_status RENAME VALUE 'completed' TO 'paid';

ALTER TYPE transaction_status ADD VALUE 'cancelled';
ALTER TYPE transaction_status ADD VALUE 'expired';
ALTER TYPE transaction_status ADD VALUE 'partially_refunded';
ALTER TYPE transaction_status ADD VALUE 'disputed';
