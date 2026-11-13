-- 0001: initial Libraria schema.
--
-- Applied migrations are immutable: the runner records a checksum and refuses
-- to start if this file changes. Make schema changes in a new numbered file.
--
-- Conventions:
--   * Money is stored as integer minor units (cents) to avoid float rounding.
--   * Timestamps are TIMESTAMPTZ so cross-device sync is unambiguous.
--   * Reader state (progress, bookmarks, highlights) hangs off user_libraries,
--     so it can only exist for a book the user actually owns.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Keeps updated_at honest without relying on application code.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TYPE user_role AS ENUM ('reader', 'publisher', 'admin');
CREATE TYPE media_type AS ENUM ('ebook', 'audiobook');
CREATE TYPE transaction_status AS ENUM ('pending', 'completed', 'failed', 'refunded');


-- ---------------------------------------------------------------------------
-- Publishers
-- ---------------------------------------------------------------------------

CREATE TABLE publishers (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  contact_email CITEXT NOT NULL,
  -- Payout details are AES-256-GCM ciphertext, never plaintext. The IV and
  -- auth tag are stored alongside; the key lives in the KMS, not the database.
  bank_details_ciphertext BYTEA,
  bank_details_iv         BYTEA,
  bank_details_auth_tag   BYTEA,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Either all three encryption fields are present, or none are.
  CONSTRAINT bank_details_complete CHECK (
    num_nulls(bank_details_ciphertext, bank_details_iv, bank_details_auth_tag) IN (0, 3)
  )
);

CREATE TRIGGER publishers_set_updated_at
  BEFORE UPDATE ON publishers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  role          user_role NOT NULL DEFAULT 'reader',
  -- Set only for publisher-portal accounts; identifies the house they act for.
  publisher_id  UUID REFERENCES publishers(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT email_shaped CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- A publisher account must be tied to a publisher; nobody else may be.
  CONSTRAINT publisher_linkage CHECK (
    (role = 'publisher') = (publisher_id IS NOT NULL)
  )
);

CREATE INDEX users_publisher_id_idx ON users (publisher_id) WHERE publisher_id IS NOT NULL;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- Books
-- ---------------------------------------------------------------------------

CREATE TABLE books (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  publisher_id UUID NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
  title        TEXT NOT NULL,
  author       TEXT NOT NULL,
  -- Digits only, no hyphens. Nullable: not every title has one assigned yet.
  isbn13       CHAR(13) UNIQUE,
  description  TEXT,
  genre        TEXT NOT NULL,
  language     CHAR(2) NOT NULL DEFAULT 'en',

  price_cents  INTEGER NOT NULL,
  currency     CHAR(3) NOT NULL DEFAULT 'USD',

  cover_image_url TEXT,
  published_at    DATE,
  -- Publishers stage a title, then flip this to list it in the storefront.
  is_available    BOOLEAN NOT NULL DEFAULT FALSE,

  -- Phase 3 headroom: audiobooks share this table, differing by media_type,
  -- file size (BIGINT, not INTEGER) and duration.
  media_type       media_type NOT NULL DEFAULT 'ebook',
  duration_seconds INTEGER,

  -- DRM asset. Null until the encrypted upload completes. IV and auth tag are
  -- AES-256-GCM parameters; GCM is used over CBC so ciphertext is tamper-evident.
  encrypted_file_url    TEXT,
  encryption_iv         BYTEA,
  encryption_auth_tag   BYTEA,
  file_size_bytes       BIGINT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT price_non_negative CHECK (price_cents >= 0),
  CONSTRAINT isbn13_digits CHECK (isbn13 IS NULL OR isbn13 ~ '^[0-9]{13}$'),
  CONSTRAINT duration_only_for_audio CHECK (
    media_type = 'audiobook' OR duration_seconds IS NULL
  ),
  -- A listed book must have a decryptable asset behind it.
  CONSTRAINT available_needs_asset CHECK (
    NOT is_available OR (
      encrypted_file_url IS NOT NULL
      AND encryption_iv IS NOT NULL
      AND encryption_auth_tag IS NOT NULL
    )
  )
);

-- Discovery: "new releases" over the listed catalogue.
CREATE INDEX books_available_published_idx
  ON books (published_at DESC NULLS LAST)
  WHERE is_available;

-- Discovery: genre filtering.
CREATE INDEX books_genre_idx ON books (genre) WHERE is_available;

CREATE INDEX books_publisher_id_idx ON books (publisher_id);

CREATE TRIGGER books_set_updated_at
  BEFORE UPDATE ON books
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------

CREATE TABLE transactions (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Purchase history outlives the catalogue entry, so books are never deleted
  -- out from under a transaction (RESTRICT above) and users are retained.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE RESTRICT,

  -- Price at time of sale; the catalogue price may change later.
  amount_cents INTEGER NOT NULL,
  currency     CHAR(3) NOT NULL DEFAULT 'USD',
  status       transaction_status NOT NULL DEFAULT 'pending',
  -- Gateway idempotency key. Unique so a replayed webhook cannot double-charge.
  payment_gateway_ref TEXT UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT amount_non_negative CHECK (amount_cents >= 0)
);

-- A user may retry a failed payment, but can only own a given book once.
CREATE UNIQUE INDEX transactions_one_completed_per_book_idx
  ON transactions (user_id, book_id)
  WHERE status = 'completed';

CREATE INDEX transactions_user_created_idx ON transactions (user_id, created_at DESC);
CREATE INDEX transactions_book_idx ON transactions (book_id);

CREATE TRIGGER transactions_set_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- User libraries (the digital bookshelf)
-- ---------------------------------------------------------------------------

CREATE TABLE user_libraries (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE RESTRICT,

  acquired_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Which transaction granted access. Null for gifts/promos/test seeds.
  transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,

  -- Furthest reading position, e.g. {"cfi": "...", "percent": 42.5}. JSONB
  -- rather than TEXT so sync can merge fields instead of clobbering a blob.
  reading_progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_read_at     TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id, book_id)
);

CREATE INDEX user_libraries_recent_idx
  ON user_libraries (user_id, last_read_at DESC NULLS LAST);

CREATE TRIGGER user_libraries_set_updated_at
  BEFORE UPDATE ON user_libraries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- Reader state: bookmarks and highlights
--
-- Both reference user_libraries rather than users+books separately, so the
-- database itself guarantees annotations only exist for owned books.
-- ---------------------------------------------------------------------------

CREATE TABLE bookmarks (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,

  -- EPUB CFI identifying the position.
  location TEXT NOT NULL,
  label    TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id, book_id)
    REFERENCES user_libraries (user_id, book_id) ON DELETE CASCADE,
  CONSTRAINT bookmark_location_unique UNIQUE (user_id, book_id, location)
);

CREATE INDEX bookmarks_user_book_idx ON bookmarks (user_id, book_id);

CREATE TABLE highlights (
  id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL,
  book_id UUID NOT NULL,

  start_location  TEXT NOT NULL,
  end_location    TEXT NOT NULL,
  highlighted_text TEXT NOT NULL,
  note            TEXT,
  color           TEXT NOT NULL DEFAULT 'yellow',

  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id, book_id)
    REFERENCES user_libraries (user_id, book_id) ON DELETE CASCADE
);

CREATE INDEX highlights_user_book_idx ON highlights (user_id, book_id);

CREATE TRIGGER highlights_set_updated_at
  BEFORE UPDATE ON highlights
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
