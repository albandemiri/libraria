-- 0007: fence asset jobs to the worker that claimed them, and track quarantine cleanup.

-- Written at every claim. Every job/asset write of a processing run is
-- conditional on it, so a worker whose lock went stale (and whose job was
-- reclaimed by another) can no longer change anything.
ALTER TABLE asset_jobs ADD COLUMN lease_id UUID;

-- Set once the plaintext original is known to be gone from quarantine; the
-- cleanup sweep only looks at terminal assets where it is still NULL.
ALTER TABLE book_assets ADD COLUMN quarantine_deleted_at TIMESTAMPTZ;

CREATE INDEX book_assets_quarantine_pending_idx
  ON book_assets (updated_at)
  WHERE quarantine_deleted_at IS NULL AND state IN ('ready', 'rejected', 'failed');
