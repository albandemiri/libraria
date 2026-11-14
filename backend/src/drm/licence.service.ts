import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { accountStatus } from '../auth/account-status';
import { env } from '../config/env';
import { pool } from '../db/pool';
import {
  accessDenied,
  type AssetSummary,
  type AuthReasonCode,
  assetSuperseded,
} from './authorization.service';
import { audit, logAssetAccess } from './drm.audit';
import { keyManagement } from './key-management.service';
import {
  licenceSigningKeyId,
  signLicence,
  type WrappedKey,
  wrapDekForDevice,
} from './licence-crypto';

/** Internal: a re-check refusal, carrying the reason for the audit trail. */
class IssuanceDenied extends Error {
  constructor(
    readonly reason: AuthReasonCode | 'ASSET_SUPERSEDED',
    readonly clientError: Error,
  ) {
    super(reason);
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type LicenceStatus = 'valid' | 'expired' | 'revoked' | 'superseded' | 'replaced' | 'unknown';

/** What the app stores and checks: signed, bound to one device, no plaintext key. */
export interface Licence {
  v: 1;
  /** Id of the signing key, see licenceSigningKeyId. */
  kid: string;
  licenceId: string;
  assetId: string;
  assetVersion: number;
  bookId: string;
  deviceId: string;
  issuedAt: string;
  expiresAt: string;
  content: {
    algorithm: 'AES-256-GCM';
    nonce: string;
    authTag: string;
    aad: { assetId: string; version: number; algorithm: 'AES-256-GCM'; kmsKeyId: string };
  };
  wrappedKey: WrappedKey;
  signature: string;
}

export interface LicenceStatusEntry {
  licenceId: string;
  status: LicenceStatus;
  currentAsset?: AssetSummary;
}

interface IssueSource {
  nonce: Buffer | null;
  auth_tag: Buffer | null;
  version: number;
  book_id: string;
  wrapped_dek: Buffer;
  kms_key_id: string;
  kms_key_version: string;
  public_key_spki: string;
}

/**
 * Issues a device-bound licence. The caller has already authorised the access
 * (authorizeAssetAccess). The DEK exists in plaintext only inside this function
 * and is zeroed on every path; nothing is written until the signed licence exists.
 */
export async function issueLicence(
  userId: string,
  assetId: string,
  deviceId: string,
  requestId: string | null = null,
): Promise<Licence> {
  const { rows } = await pool.query<IssueSource>(
    `SELECT ba.nonce, ba.auth_tag, ba.version, ba.book_id,
            k.wrapped_dek, k.kms_key_id, k.kms_key_version,
            d.public_key_spki
       FROM book_assets ba
       JOIN asset_keys k ON k.asset_id = ba.id
       JOIN devices d ON d.id = $2 AND d.user_id = $3
      WHERE ba.id = $1`,
    [assetId, deviceId, userId],
  );
  const source = rows[0];
  if (!source?.nonce || !source.auth_tag) {
    throw accessDenied();
  }

  const licenceId = randomUUID();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + env.LICENCE_DAYS * DAY_MS);

  const dek = await keyManagement().unwrap(
    source.wrapped_dek,
    source.kms_key_id,
    source.kms_key_version,
  );
  let wrappedKey: WrappedKey;
  try {
    wrappedKey = wrapDekForDevice(dek, source.public_key_spki, { licenceId, assetId, deviceId });
  } finally {
    dek.fill(0);
  }

  const unsigned = {
    v: 1 as const,
    kid: licenceSigningKeyId(),
    licenceId,
    assetId,
    assetVersion: source.version,
    bookId: source.book_id,
    deviceId,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    content: {
      algorithm: 'AES-256-GCM' as const,
      nonce: source.nonce.toString('base64url'),
      authTag: source.auth_tag.toString('base64url'),
      aad: {
        assetId,
        version: source.version,
        algorithm: 'AES-256-GCM' as const,
        kmsKeyId: source.kms_key_id,
      },
    },
    wrappedKey,
  };
  const licence: Licence = { ...unsigned, signature: signLicence(unsigned) };

  await issuanceHook?.();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // One renewal at a time per user, device and book, so two racing requests
    // cannot both leave a live licence behind.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `licence:${userId}:${deviceId}:${source.book_id}`,
    ]);
    await recheckAccess(client, userId, assetId, deviceId);
    await supersedePrevious(client, userId, deviceId, source.book_id);
    await client.query(
      'UPDATE devices SET licence_issued = TRUE WHERE id = $1 AND NOT licence_issued',
      [deviceId],
    );
    await client.query(
      `INSERT INTO licences (id, user_id, device_id, asset_id, issued_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [licenceId, userId, deviceId, assetId, issuedAt, expiresAt],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof IssuanceDenied) {
      // Authorization logged an allow; the trail must also show why nothing was issued.
      await logAssetAccess({
        userId,
        assetId,
        deviceId,
        action: 'decryption_authorization',
        decision: 'deny',
        reasonCode: error.reason,
        requestId,
      });
      throw error.clientError;
    }
    throw error;
  } finally {
    client.release();
  }
  return licence;
}

/**
 * Authorization ran before the crypto and the lock; state may have changed since
 * (refund, revocation, suspension, takedown, new version). Nothing is issued unless
 * everything still holds.
 */
async function recheckAccess(
  client: PoolClient,
  userId: string,
  assetId: string,
  deviceId: string,
): Promise<void> {
  const { rows } = await client.query<{
    state: string;
    withdrawn_at: Date | null;
    current_asset_id: string | null;
    device_revoked_at: Date | null;
    user_status: string;
    entitled: boolean;
    cur_version: number | null;
    cur_size: string | null;
    cur_sha256: string | null;
  }>(
    `SELECT ba.state, b.withdrawn_at, b.current_asset_id,
            d.revoked_at AS device_revoked_at, u.status AS user_status,
            EXISTS (SELECT 1 FROM entitlements e
                     WHERE e.user_id = $3 AND e.book_id = ba.book_id AND e.status = 'active') AS entitled,
            cur.version AS cur_version, cur.ciphertext_size_bytes AS cur_size,
            cur.ciphertext_sha256 AS cur_sha256
       FROM book_assets ba
       JOIN books b ON b.id = ba.book_id
       JOIN devices d ON d.id = $2 AND d.user_id = $3
       JOIN users u ON u.id = $3
       LEFT JOIN book_assets cur ON cur.id = b.current_asset_id
      WHERE ba.id = $1
      -- Lock order is user, then device everywhere. NO KEY UPDATE up front (no later upgrade)
      -- still lets the licence insert take its FOR KEY SHARE on the user and device rows.
      FOR NO KEY UPDATE OF d`,
    [assetId, deviceId, userId],
  );
  const row = rows[0];
  const deny = (reason: AuthReasonCode) => new IssuanceDenied(reason, accessDenied());
  if (row?.state !== 'ready' || !row.current_asset_id) throw deny('ASSET_UNAVAILABLE');
  if (row.user_status !== 'active') throw deny('ACCOUNT_SUSPENDED');
  if (row.withdrawn_at) throw deny('BOOK_WITHDRAWN');
  if (!row.entitled) throw deny('NO_ENTITLEMENT');
  if (row.device_revoked_at) throw deny('DEVICE_REVOKED');
  if (row.current_asset_id !== assetId) {
    throw new IssuanceDenied(
      'ASSET_SUPERSEDED',
      assetSuperseded({
        assetId: row.current_asset_id,
        version: row.cur_version ?? 0,
        sizeBytes: Number(row.cur_size),
        sha256: row.cur_sha256 ?? '',
      }),
    );
  }
}

async function supersedePrevious(
  client: PoolClient,
  userId: string,
  deviceId: string,
  bookId: string,
): Promise<void> {
  await client.query(
    `UPDATE licences l
        SET superseded_at = NOW()
       FROM book_assets ba
      WHERE ba.id = l.asset_id AND ba.book_id = $3
        AND l.user_id = $1 AND l.device_id = $2 AND l.superseded_at IS NULL`,
    [userId, deviceId, bookId],
  );
}

interface StatusRow {
  id: string;
  expires_at: Date;
  superseded_at: Date | null;
  revoked_at: Date | null;
  asset_id: string;
  withdrawn_at: Date | null;
  device_revoked_at: Date | null;
  entitled: boolean;
  current_id: string | null;
  current_version: number | null;
  current_size: string | null;
  current_sha256: string | null;
}

/**
 * Status of each licence for the calling user's own device. A licence that was
 * not issued to this user and device is `unknown`, exactly like one that does not
 * exist. Precedence: unknown, revoked, replaced, superseded, expired, valid.
 */
export async function licenceStatuses(
  userId: string,
  deviceId: string,
  licenceIds: string[],
): Promise<LicenceStatusEntry[]> {
  const ids = [...new Set(licenceIds.map((id) => id.toLowerCase()))];
  const suspended = (await accountStatus(userId)) !== 'active';

  const { rows } = await pool.query<StatusRow>(
    `SELECT l.id, l.expires_at, l.superseded_at, l.revoked_at, l.asset_id,
            b.withdrawn_at,
            d.revoked_at AS device_revoked_at,
            EXISTS (SELECT 1 FROM entitlements e
                     WHERE e.user_id = l.user_id AND e.book_id = ba.book_id
                       AND e.status = 'active') AS entitled,
            cur.id AS current_id, cur.version AS current_version,
            cur.ciphertext_size_bytes AS current_size, cur.ciphertext_sha256 AS current_sha256
       FROM licences l
       JOIN book_assets ba ON ba.id = l.asset_id
       JOIN books b ON b.id = ba.book_id
       JOIN devices d ON d.id = l.device_id
       LEFT JOIN book_assets cur ON cur.id = b.current_asset_id AND cur.state = 'ready'
      WHERE l.user_id = $1 AND l.device_id = $2 AND l.id = ANY($3::uuid[])`,
    [userId, deviceId, ids],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const now = Date.now();

  return ids.map((licenceId): LicenceStatusEntry => {
    const row = byId.get(licenceId);
    if (!row) return { licenceId, status: 'unknown' };
    if (row.revoked_at || suspended || row.device_revoked_at || row.withdrawn_at || !row.entitled) {
      return { licenceId, status: 'revoked' };
    }
    if (row.current_id && row.current_id !== row.asset_id) {
      return {
        licenceId,
        status: 'replaced',
        currentAsset: {
          assetId: row.current_id,
          version: row.current_version ?? 0,
          sizeBytes: Number(row.current_size),
          sha256: row.current_sha256 ?? '',
        },
      };
    }
    if (row.superseded_at) return { licenceId, status: 'superseded' };
    if (row.expires_at.getTime() <= now) return { licenceId, status: 'expired' };
    return { licenceId, status: 'valid' };
  });
}

/**
 * Withdraws one device's access to one book: its licences for the book report
 * `revoked` at the next check-in. The device stays active and no removal is
 * counted. Idempotent.
 */
export async function revokeDeviceAccess(
  userId: string,
  bookId: string,
  deviceId: string,
): Promise<void> {
  const { rowCount } = await pool.query(
    `UPDATE licences l
        SET revoked_at = NOW(), superseded_at = COALESCE(l.superseded_at, NOW())
       FROM book_assets ba
      WHERE ba.id = l.asset_id AND ba.book_id = $3
        AND l.user_id = $1 AND l.device_id = $2 AND l.revoked_at IS NULL`,
    [userId, deviceId, bookId],
  );
  await audit({
    actorId: userId,
    action: 'licence.device_access_revoked',
    resourceType: 'device',
    resourceId: deviceId,
    metadata: { bookId, licencesRevoked: rowCount ?? 0 },
  });
}

let issuanceHook: (() => Promise<void>) | null = null;
/** Test seam: runs after authorization and crypto, just before the issuance transaction. */
export function setIssuanceHookForTests(hook: (() => Promise<void>) | null): void {
  issuanceHook = hook;
}
