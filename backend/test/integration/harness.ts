/**
 * Integration test harness: a real Express server against a real PostgreSQL
 * database, migrated from db/migrations.
 *
 * Import this before anything from src/ in every integration test file.
 */

import './env';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { app, API_PREFIX } from '../../src/app';
import { signAccessToken, type UserRole } from '../../src/auth/tokens';
import { env } from '../../src/config/env';
import { runMigrations } from '../../src/db/migrate';
import { pool } from '../../src/db/pool';
import { assetAad, encryptAsset } from '../../src/drm/encryption.service';
import { buildEpub } from '../../src/drm/epub/fixtures';
import { keyManagement } from '../../src/drm/key-management.service';
import { objectStorage } from '../../src/drm/object-storage';

/** Guards the TRUNCATE below from ever reaching a development database. */
function assertTestDatabase(): void {
  if (!env.POSTGRES_DB.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${env.POSTGRES_DB}": ` +
        'the database name must end in _test.',
    );
  }
}

async function ensureDatabaseExists(): Promise<void> {
  const admin = new Pool({
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: 'postgres',
    max: 1,
  });
  try {
    const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      env.POSTGRES_DB,
    ]);
    if (rowCount === 0) {
      // Identifier cannot be parameterised; it has passed assertTestDatabase
      // and comes from our own environment, and is quoted regardless.
      await admin.query(`CREATE DATABASE "${env.POSTGRES_DB.replace(/"/g, '""')}"`);
    }
  } finally {
    await admin.end();
  }
}

/** Empties every application table, leaving migration history in place. */
export async function resetDatabase(): Promise<void> {
  assertTestDatabase();
  const { rows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> 'schema_migrations'`,
  );
  if (rows.length > 0) {
    const tables = rows.map((row) => `"${row.tablename}"`).join(', ');
    await pool.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  }
}

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

/** Creates/migrates/empties the test database and starts the app on a free port. */
export async function startTestServer(): Promise<TestServer> {
  assertTestDatabase();
  await ensureDatabaseExists();
  await runMigrations(pool);
  await resetDatabase();

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}${API_PREFIX}`,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: tests assert on arbitrary response JSON; a typed default would force a cast on every assertion.
export interface ApiResponse<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export type Api = ReturnType<typeof client>;

export function client(baseUrl: string) {
  // biome-ignore lint/suspicious/noExplicitAny: see ApiResponse.
  return async function api<T = any>(
    method: string,
    path: string,
    options: {
      token?: string;
      body?: unknown;
      rawBody?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined || options.rawBody !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body:
        options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });

    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      headers: response.headers,
    };
  };
}

// ---------------------------------------------------------------------------
// Fixtures. Inserted directly so each test states only what it depends on.
// ---------------------------------------------------------------------------

let sequence = 0;
const next = () => ++sequence;

/**
 * A publisher with a contract rate (20% from 2020 unless stated), so its books
 * can be sold. `commissionBps: null` creates one without any rate.
 */
export async function createPublisher(
  name = `Publisher ${next()}`,
  options: { commissionBps?: number | null; effectiveFrom?: string } = {},
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO publishers (name, contact_email) VALUES ($1, $2) RETURNING id`,
    [name, `contact${next()}@publisher.test`],
  );
  const id = rows[0].id;
  const commissionBps = options.commissionBps === undefined ? 2000 : options.commissionBps;
  if (commissionBps !== null) {
    await pool.query(
      `INSERT INTO publisher_commission_rates (publisher_id, rate_bps, effective_from)
       VALUES ($1, $2, $3)`,
      [id, commissionBps, options.effectiveFrom ?? '2020-01-01T00:00:00Z'],
    );
  }
  return id;
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  role: UserRole;
  publisherId: string | null;
}

export async function createUser(
  options: { role?: UserRole; publisherId?: string | null } = {},
): Promise<TestUser> {
  const role = options.role ?? 'reader';
  const publisherId = options.publisherId ?? null;
  const email = `user${next()}@reader.test`;

  // Fixture users authenticate with signed tokens; the hash is never checked.
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, publisher_id)
     VALUES ($1, 'fixture-not-a-real-hash', $2, $3) RETURNING id`,
    [email, role, publisherId],
  );

  const id = rows[0].id;
  return {
    id,
    email,
    role,
    publisherId,
    token: signAccessToken({ userId: id, role, publisherId }),
  };
}

/** An EPUB accepted by the ingestion validator, unique per call. */
export function sampleEpub(title = 'Test Book'): Buffer {
  return buildEpub({ title });
}

/**
 * Creates a real ready asset for a book (real encryption with a fresh DEK from
 * the configured KMS, ciphertext in the configured object storage) and makes it
 * the book's current asset.
 */
export async function createReadyAsset(
  bookId: string,
  epub: Buffer = sampleEpub(),
): Promise<{ assetId: string; version: number }> {
  const assetId = randomUUID();
  const { rows: versionRows } = await pool.query<{ version: number }>(
    `SELECT COALESCE(MAX(version), 0) + 1 AS version FROM book_assets WHERE book_id = $1`,
    [bookId],
  );
  const version = versionRows[0].version;

  const dek = await keyManagement().generateDataKey();
  try {
    const { ciphertext, nonce, authTag } = encryptAsset(
      epub,
      dek.plaintext,
      assetAad({ assetId, version, kmsKeyId: dek.keyId }),
    );
    const objectKey = `assets/${assetId}/v${version}`;
    await objectStorage().put(objectKey, ciphertext);

    await pool.query(
      `INSERT INTO book_assets (id, book_id, version, state, original_size_bytes, object_key,
                                ciphertext_size_bytes, ciphertext_sha256, nonce, auth_tag,
                                ready_at, activated_at)
       VALUES ($1, $2, $3, 'ready', $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
      [
        assetId,
        bookId,
        version,
        epub.length,
        objectKey,
        ciphertext.length,
        createHash('sha256').update(ciphertext).digest('hex'),
        nonce,
        authTag,
      ],
    );
    await pool.query(
      `INSERT INTO asset_keys (asset_id, wrapped_dek, kms_key_id, kms_key_version, wrapping_algorithm)
       VALUES ($1, $2, $3, $4, 'AES-256-GCM')`,
      [assetId, dek.wrapped, dek.keyId, dek.keyVersion],
    );
    await pool.query(`UPDATE books SET current_asset_id = $1 WHERE id = $2`, [assetId, bookId]);
  } finally {
    dek.plaintext.fill(0);
  }
  return { assetId, version };
}

export async function createBook(
  publisherId: string,
  options: { available?: boolean; priceCents?: number; title?: string } = {},
): Promise<string> {
  const available = options.available ?? true;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO books (publisher_id, title, author, genre, price_cents, is_available)
     VALUES ($1, $2, 'Test Author', 'Fiction', $3, FALSE)
     RETURNING id`,
    [publisherId, options.title ?? `Book ${next()}`, options.priceCents ?? 499],
  );
  const bookId = rows[0].id;
  if (available) {
    // An available book must have a ready current asset.
    await createReadyAsset(bookId);
    await pool.query(`UPDATE books SET is_available = TRUE WHERE id = $1`, [bookId]);
  }
  return bookId;
}

/** Grants ownership without a transaction, as a gift/promo would. */
export async function grantBook(userId: string, bookId: string): Promise<void> {
  await pool.query(`INSERT INTO entitlements (user_id, book_id, source) VALUES ($1, $2, 'grant')`, [
    userId,
    bookId,
  ]);
  await pool.query(`INSERT INTO user_libraries (user_id, book_id) VALUES ($1, $2)`, [
    userId,
    bookId,
  ]);
}

export { pool };

// ---------------------------------------------------------------------------
// Commerce helpers (simulated provider)
// ---------------------------------------------------------------------------

/** Starts a checkout and confirms payment through the sandbox provider. */
export async function buy(api: Api, token: string, bookIds: string[]): Promise<string> {
  const checkout = await api('POST', '/checkout-sessions', { token, body: { bookIds } });
  if (checkout.status !== 201) {
    throw new Error(`checkout failed: ${checkout.status} ${JSON.stringify(checkout.body)}`);
  }
  const id: string = checkout.body.transaction.id;
  const paid = await api('POST', `/sandbox/transactions/${id}/events`, {
    token,
    body: { kind: 'payment_succeeded' },
  });
  if (paid.status !== 200) {
    throw new Error(`sandbox payment failed: ${paid.status} ${JSON.stringify(paid.body)}`);
  }
  return id;
}

export { signWebhook } from '../../src/commerce/signature';
export { SIMULATED_SIGNATURE_HEADER } from '../../src/commerce/providers/simulated';
