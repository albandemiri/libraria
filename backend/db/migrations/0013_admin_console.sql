-- Admin console: a publisher's country, and one-time invite links for its first logins.

-- Two-letter country code; null for houses created before the console existed.
ALTER TABLE publishers
  ADD COLUMN country CHAR(2) CONSTRAINT publishers_country_shape CHECK (country ~ '^[A-Z]{2}$');

CREATE TABLE publisher_invites (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  publisher_id     UUID NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
  email            CITEXT NOT NULL,
  display_name     TEXT,
  -- SHA-256 of the 32-byte random token. The token itself is never stored.
  token_hash       BYTEA NOT NULL UNIQUE,
  expires_at       TIMESTAMPTZ NOT NULL,
  accepted_at      TIMESTAMPTZ,
  accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at       TIMESTAMPTZ,
  created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT invite_email_shaped CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT invite_token_hash_length CHECK (octet_length(token_hash) = 32),
  -- An invite is used up or cancelled, never both.
  CONSTRAINT invite_single_outcome CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);

-- At most one pending invite per publisher and email.
CREATE UNIQUE INDEX publisher_invites_open_idx
  ON publisher_invites (publisher_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX publisher_invites_publisher_idx ON publisher_invites (publisher_id, created_at DESC);
