import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../db/pool';
import type { AssetRow } from './asset-repository';
import { objectStorage } from './object-storage';

export const DOWNLOAD_TOKEN_TTL_MS = 5 * 60 * 1000;

/** 32 random bytes, base64url: 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface IssuedGrant {
  token: string;
  expiresAt: Date;
}

/** Creates a reusable, 5-minute grant. Only the token's SHA-256 is stored. */
export async function issueDownloadGrant(input: {
  userId: string;
  deviceId: string;
  assetId: string;
}): Promise<IssuedGrant> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DOWNLOAD_TOKEN_TTL_MS);
  await pool.query(
    `INSERT INTO download_grants (token_sha256, user_id, device_id, asset_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [sha256Hex(token), input.userId, input.deviceId, input.assetId, expiresAt],
  );
  return { token, expiresAt };
}

/**
 * The asset a token grants, if the token is known and unexpired and the asset
 * is still `ready` and its book not withdrawn. Nothing else is re-checked: the
 * policy ran when the grant was issued and the grant lives five minutes.
 */
export async function assetForToken(token: string): Promise<AssetRow | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const { rows } = await pool.query<AssetRow>(
    `SELECT ba.*
       FROM download_grants g
       JOIN book_assets ba ON ba.id = g.asset_id
       JOIN books b ON b.id = ba.book_id
      WHERE g.token_sha256 = $1
        AND g.expires_at > NOW()
        AND ba.state = 'ready'
        AND ba.object_key IS NOT NULL
        AND b.withdrawn_at IS NULL`,
    [sha256Hex(token)],
  );
  return rows[0] ?? null;
}

export type ByteRange = { start: number; end: number } | 'unsatisfiable' | null;

/**
 * Parses a single `bytes=` range against the object size. Returns null for
 * anything malformed or unsupported (the caller serves the full body), the
 * clamped inclusive range when satisfiable, and 'unsatisfiable' for a start at
 * or past the end, an inverted range, or a zero-length suffix.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, first, last] = match;
  if (first === '' && last === '') return null;

  if (first === '') {
    const suffix = Number(last);
    if (!Number.isSafeInteger(suffix)) return null;
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(first);
  if (!Number.isSafeInteger(start)) return null;
  if (last === '') return start >= size ? 'unsatisfiable' : { start, end: size - 1 };

  const end = Number(last);
  if (!Number.isSafeInteger(end)) return null;
  if (end < start || start >= size) return 'unsatisfiable';
  return { start, end: Math.min(end, size - 1) };
}

/**
 * The stored object's size, taken from storage and cross-checked with the
 * database so a truncated or swapped object is never served as partial content.
 */
export async function ciphertextSize(asset: AssetRow): Promise<number | null> {
  if (!asset.object_key) return null;
  const head = await objectStorage().head(asset.object_key);
  if (!head) return null;
  if (String(head.size) !== asset.ciphertext_size_bytes) {
    throw new Error('Stored ciphertext size does not match the asset record');
  }
  return head.size;
}

/**
 * Deletes grants that expired more than a day ago (an expired grant is already useless;
 * the day of slack only keeps recent rows around for support). Returns how many went.
 */
export async function purgeExpiredDownloadGrants(): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM download_grants WHERE expires_at < NOW() - INTERVAL '1 day'`,
  );
  return rowCount ?? 0;
}
