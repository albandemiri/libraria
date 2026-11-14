-- 0006: book assets, device-bound DRM and account/book controls.
--
-- Replaces the legacy per-book columns (encrypted_file_url, encryption_iv,
-- encryption_auth_tag, file_size_bytes) whose content was encrypted with a key
-- derived from the login secret. Every asset is now an immutable, versioned
-- row with its own random data key, wrapped by the KMS (asset_keys).
--
-- Data safety: existing books keep their rows (and every purchase,
-- entitlement and library entry that references them). Only their listing
-- flag is cleared, because the old files cannot be served safely; a publisher
-- re-uploads through the ingestion pipeline and republishes.

CREATE TYPE user_status AS ENUM ('active', 'suspended');
CREATE TYPE asset_state AS ENUM (
  'uploaded', 'validating', 'scanning', 'encrypting', 'storing',
  'ready', 'rejected', 'failed'
);
CREATE TYPE asset_job_state AS ENUM ('queued', 'running', 'done', 'failed');
CREATE TYPE device_platform AS ENUM ('ios', 'android', 'desktop');
CREATE TYPE asset_access_action AS ENUM ('download_authorization', 'decryption_authorization');

-- ---------------------------------------------------------------------------
-- Accounts and takedown
-- ---------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN status user_status NOT NULL DEFAULT 'active';

ALTER TABLE books
  ADD COLUMN withdrawn_at     TIMESTAMPTZ,
  ADD COLUMN withdrawn_reason TEXT;

-- ---------------------------------------------------------------------------
-- Assets
-- ---------------------------------------------------------------------------

CREATE TABLE book_assets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id     UUID NOT NULL REFERENCES books(id) ON DELETE RESTRICT,
  version     INTEGER NOT NULL,
  state       asset_state NOT NULL DEFAULT 'uploaded',
  -- Machine-readable code plus safe text; never plaintext content.
  reason_code   TEXT,
  reason_detail TEXT,
  original_size_bytes BIGINT NOT NULL,
  -- Opaque storage key of the ciphertext; null until stored.
  object_key             TEXT,
  ciphertext_size_bytes  BIGINT,
  -- Lower-case hex SHA-256 of the ciphertext.
  ciphertext_sha256      TEXT,
  encryption_algorithm   TEXT NOT NULL DEFAULT 'AES-256-GCM',
  nonce      BYTEA,
  auth_tag   BYTEA,
  extracted_metadata JSONB,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ready_at     TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  activated_by UUID REFERENCES users(id) ON DELETE SET NULL,

  CONSTRAINT book_assets_version_positive CHECK (version >= 1),
  CONSTRAINT book_assets_book_version_key UNIQUE (book_id, version),
  CONSTRAINT book_assets_ready_complete CHECK (
    state <> 'ready' OR (
      object_key IS NOT NULL
      AND nonce IS NOT NULL
      AND auth_tag IS NOT NULL
      AND ciphertext_sha256 IS NOT NULL
    )
  )
);

-- At most one asset per book may be in flight.
CREATE UNIQUE INDEX book_assets_one_in_flight_idx
  ON book_assets (book_id)
  WHERE state NOT IN ('ready', 'rejected', 'failed');

CREATE TRIGGER book_assets_set_updated_at
  BEFORE UPDATE ON book_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Holds only the KMS-wrapped data key, never a plaintext one.
CREATE TABLE asset_keys (
  asset_id           UUID PRIMARY KEY REFERENCES book_assets(id) ON DELETE CASCADE,
  wrapped_dek        BYTEA NOT NULL,
  kms_key_id         TEXT NOT NULL,
  kms_key_version    TEXT NOT NULL,
  wrapping_algorithm TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE asset_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  asset_id        UUID NOT NULL REFERENCES book_assets(id) ON DELETE CASCADE,
  state           asset_job_state NOT NULL DEFAULT 'queued',
  attempts        INTEGER NOT NULL DEFAULT 0,
  -- Backoff: a queued job is claimable once run_after has passed.
  run_after       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at       TIMESTAMPTZ,
  last_error_code TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX asset_jobs_claim_idx ON asset_jobs (run_after) WHERE state = 'queued';
CREATE INDEX asset_jobs_asset_id_idx ON asset_jobs (asset_id);

CREATE TRIGGER asset_jobs_set_updated_at
  BEFORE UPDATE ON asset_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- books.current_asset_id replaces the legacy columns
-- ---------------------------------------------------------------------------

ALTER TABLE books
  ADD COLUMN current_asset_id UUID REFERENCES book_assets(id) ON DELETE RESTRICT;

ALTER TABLE books DROP CONSTRAINT available_needs_asset;

-- Old files were encrypted with login-derived keys: stop listing them.
UPDATE books SET is_available = FALSE;

ALTER TABLE books
  DROP COLUMN encrypted_file_url,
  DROP COLUMN encryption_iv,
  DROP COLUMN encryption_auth_tag,
  DROP COLUMN file_size_bytes;

-- The application additionally requires the asset to be 'ready'.
ALTER TABLE books
  ADD CONSTRAINT available_needs_asset CHECK (NOT is_available OR current_asset_id IS NOT NULL);

CREATE INDEX books_current_asset_id_idx
  ON books (current_asset_id) WHERE current_asset_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Devices and licences
-- ---------------------------------------------------------------------------

CREATE TABLE devices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform          device_platform NOT NULL,
  display_name      TEXT NOT NULL,
  -- P-256 SubjectPublicKeyInfo, base64url.
  public_key_spki   TEXT NOT NULL,
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set at the device's first licence; only such removals count toward the cap.
  licence_issued    BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at        TIMESTAMPTZ,
  revocation_reason TEXT,

  CONSTRAINT devices_user_key_key UNIQUE (user_id, public_key_spki)
);

CREATE INDEX devices_user_id_idx ON devices (user_id);

CREATE TABLE device_removals (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id  UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  removed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX device_removals_user_removed_idx ON device_removals (user_id, removed_at);

CREATE TABLE download_grants (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- SHA-256 of the token, lower-case hex; the token itself is never stored.
  token_sha256 TEXT NOT NULL,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  asset_id     UUID NOT NULL REFERENCES book_assets(id) ON DELETE CASCADE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT download_grants_token_key UNIQUE (token_sha256)
);

CREATE INDEX download_grants_expires_idx ON download_grants (expires_at);

-- Issuance record for audit and support; holds no key material.
CREATE TABLE licences (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id     UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  asset_id      UUID NOT NULL REFERENCES book_assets(id) ON DELETE CASCADE,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TIMESTAMPTZ NOT NULL,
  superseded_at TIMESTAMPTZ
);

CREATE INDEX licences_device_asset_idx ON licences (device_id, asset_id, issued_at DESC);

-- ---------------------------------------------------------------------------
-- Logs
-- ---------------------------------------------------------------------------

CREATE TABLE asset_access_logs (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  asset_id    UUID REFERENCES book_assets(id) ON DELETE SET NULL,
  device_id   UUID REFERENCES devices(id) ON DELETE SET NULL,
  action      asset_access_action NOT NULL,
  decision    TEXT NOT NULL,
  reason_code TEXT,
  request_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT asset_access_logs_decision_valid CHECK (decision IN ('allow', 'deny'))
);

CREATE INDEX asset_access_logs_user_idx ON asset_access_logs (user_id, created_at DESC);
CREATE INDEX asset_access_logs_asset_idx ON asset_access_logs (asset_id, created_at DESC);

CREATE TABLE audit_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   TEXT,
  -- Redacted: never keys, tokens or plaintext content.
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX audit_events_resource_idx
  ON audit_events (resource_type, resource_id, created_at DESC);
