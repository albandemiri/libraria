-- A licence whose user, device and book access was withdrawn through device-access.
-- Kept apart from superseded_at: renewal supersedes quietly, revocation must be
-- reported to the app as "revoked" at its next check-in.
ALTER TABLE licences ADD COLUMN revoked_at TIMESTAMPTZ;
