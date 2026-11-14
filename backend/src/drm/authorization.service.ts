import { accountStatus } from '../auth/account-status';
import { hasActiveEntitlement } from '../commerce/entitlements';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errors';
import { type AssetRow, currentReadyAsset } from './asset-repository';
import { type DeviceDto, touchDevice } from './device.service';
import { logAssetAccess } from './drm.audit';

/** Internal reasons, recorded in asset_access_logs only; clients never see them. */
export type AuthReasonCode =
  | 'ACCOUNT_SUSPENDED'
  | 'NO_ENTITLEMENT'
  | 'BOOK_WITHDRAWN'
  | 'ASSET_UNAVAILABLE'
  | 'DEVICE_UNKNOWN'
  | 'DEVICE_REVOKED'
  | 'DEVICE_LIMIT_REACHED'
  | 'RATE_LIMITED';

export type AssetAction = 'download_authorization' | 'decryption_authorization';

export interface AssetSummary {
  assetId: string;
  version: number;
  sizeBytes: number;
  sha256: string;
}

export interface AuthorizationRequest {
  userId: string;
  assetId: string;
  deviceId: string;
  action: AssetAction;
  requestId?: string | null;
}

export type AuthorizationResult =
  | { ok: true; asset: AssetRow; device: DeviceDto }
  | { ok: false; status: 403; reasonCode: AuthReasonCode }
  | { ok: false; status: 409; current: AssetSummary }
  /** Ownership and entitlement passed, but a lapsed device has no free slot. */
  | { ok: false; status: 409; deviceLimit: AppError };

/** The shape clients see for an asset, from a ready row. */
export function assetSummary(asset: AssetRow): AssetSummary {
  return {
    assetId: asset.id,
    version: asset.version,
    sizeBytes: Number(asset.ciphertext_size_bytes),
    sha256: asset.ciphertext_sha256 ?? '',
  };
}

/** The one client-visible refusal. Same body whatever the internal reason. */
export function accessDenied(): AppError {
  return new AppError(403, 'Access to this asset is not allowed', 'ASSET_ACCESS_DENIED');
}

/** The error a refused authorization maps to; the same for every route that grants access. */
export function authorizationError(decision: Exclude<AuthorizationResult, { ok: true }>): AppError {
  if (decision.status === 403) return accessDenied();
  return 'deviceLimit' in decision ? decision.deviceLimit : assetSuperseded(decision.current);
}

/** The 409 for a stale version, sent only once every other check has passed. */
export function assetSuperseded(current: AssetSummary): AppError {
  return new AppError(409, 'A newer version of this book is available', 'ASSET_SUPERSEDED', {
    currentAssetId: current.assetId,
    version: current.version,
    sizeBytes: current.sizeBytes,
    sha256: current.sha256,
  });
}

interface DeviceOwnership {
  user_id: string;
  revoked_at: Date | null;
}

/** Which referenced rows exist: the access log has foreign keys, so unknown ids are logged as null. */
interface Known {
  asset: boolean;
  device: boolean;
}

async function decide(req: AuthorizationRequest, known: Known): Promise<AuthorizationResult> {
  const deny = (reasonCode: AuthReasonCode): AuthorizationResult => ({
    ok: false,
    status: 403,
    reasonCode,
  });

  if ((await accountStatus(req.userId)) !== 'active') return deny('ACCOUNT_SUSPENDED');

  const { rows: assetRows } = await pool.query<AssetRow & { withdrawn_at: Date | null }>(
    `SELECT ba.*, b.withdrawn_at
       FROM book_assets ba JOIN books b ON b.id = ba.book_id
      WHERE ba.id = $1`,
    [req.assetId],
  );
  const asset = assetRows[0];
  known.asset = Boolean(asset);
  if (asset?.state !== 'ready' || !asset.object_key) return deny('ASSET_UNAVAILABLE');
  if (asset.withdrawn_at) return deny('BOOK_WITHDRAWN');

  if (!(await hasActiveEntitlement(req.userId, asset.book_id))) return deny('NO_ENTITLEMENT');

  // A device that is not the caller's looks exactly like one that does not exist.
  const { rows: deviceRows } = await pool.query<DeviceOwnership>(
    'SELECT user_id, revoked_at FROM devices WHERE id = $1',
    [req.deviceId],
  );
  const owned = deviceRows[0];
  known.device = Boolean(owned);
  if (!owned || owned.user_id !== req.userId) return deny('DEVICE_UNKNOWN');
  if (owned.revoked_at) return deny('DEVICE_REVOKED');

  let device: DeviceDto;
  try {
    device = await touchDevice(req.deviceId);
  } catch (error) {
    // Revoked in the meantime: the usual 403. A lapsed device with no free slot gets the
    // designed 409 DEVICE_LIMIT_REACHED with the counted devices; ownership and entitlement
    // have already passed, so it reveals nothing the caller does not own.
    if (error instanceof AppError) {
      if (error.code === 'DEVICE_LIMIT_REACHED') {
        return { ok: false, status: 409, deviceLimit: error };
      }
      return deny('DEVICE_REVOKED');
    }
    throw error;
  }

  // Only a fully authorised owner learns that a newer version exists.
  const current = await currentReadyAsset(asset.book_id);
  if (current && current.id !== asset.id) {
    return { ok: false, status: 409, current: assetSummary(current) };
  }
  if (!current) return deny('ASSET_UNAVAILABLE');

  return { ok: true, asset, device };
}

function logReason(
  result: Exclude<AuthorizationResult, { ok: true }>,
): AuthReasonCode | 'ASSET_SUPERSEDED' {
  if (result.status === 403) return result.reasonCode;
  return 'deviceLimit' in result ? 'DEVICE_LIMIT_REACHED' : 'ASSET_SUPERSEDED';
}

/**
 * The single policy for handing out access to a ciphertext or its key. Checks
 * run in a fixed order and stop at the first failure; every outcome is logged.
 */
export async function authorizeAssetAccess(
  req: AuthorizationRequest,
): Promise<AuthorizationResult> {
  const known: Known = { asset: false, device: false };
  const result = await decide(req, known);
  await logAssetAccess({
    userId: req.userId,
    assetId: known.asset ? req.assetId : null,
    deviceId: known.device ? req.deviceId : null,
    action: req.action,
    decision: result.ok ? 'allow' : 'deny',
    reasonCode: result.ok ? null : logReason(result),
    requestId: req.requestId ?? null,
  });
  return result;
}
