import { pool } from '../db/pool';

export type AccountStatus = 'active' | 'suspended';

const TTL_MS = 30_000;
export const MAX_CACHE_ENTRIES = 10_000;

interface Entry {
  status: AccountStatus;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

async function loadFromDatabase(userId: string): Promise<AccountStatus | null> {
  const { rows } = await pool.query<{ status: AccountStatus }>(
    'SELECT status FROM users WHERE id = $1',
    [userId],
  );
  return rows[0]?.status ?? null;
}

let loader: (userId: string) => Promise<AccountStatus | null> = loadFromDatabase;

/** Test seam: swaps the database lookup. Pass nothing to restore it. */
export function setAccountStatusLoader(
  replacement?: (userId: string) => Promise<AccountStatus | null>,
): void {
  loader = replacement ?? loadFromDatabase;
  cache.clear();
}

function insert(userId: string, status: AccountStatus): void {
  const now = Date.now();
  cache.delete(userId);
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Expired entries first; if still full, drop the oldest inserted (Map keeps insertion order).
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(key);
    }
    while (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }
  cache.set(userId, { status, expiresAt: now + TTL_MS });
}

/** Current number of cached entries (for tests). */
export function accountStatusCacheSize(): number {
  return cache.size;
}

/**
 * The account's status, cached per process for 30 seconds. A deleted account
 * (null) is never cached. Changes made through this process call
 * `invalidateAccountStatus`; a change made elsewhere takes effect within the TTL.
 */
export async function accountStatus(userId: string): Promise<AccountStatus | null> {
  const hit = cache.get(userId);
  if (hit) {
    if (hit.expiresAt > Date.now()) return hit.status;
    cache.delete(userId);
  }

  const status = await loader(userId);
  if (status === null) {
    cache.delete(userId);
  } else {
    insert(userId, status);
  }
  return status;
}

export function invalidateAccountStatus(userId: string): void {
  cache.delete(userId);
}

export function clearAccountStatusCache(): void {
  cache.clear();
}
