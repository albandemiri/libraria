import { pipeline } from 'node:stream/promises';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import {
  assetForToken,
  ciphertextSize,
  issueDownloadGrant,
  parseRange,
} from '../drm/asset-delivery.service';
import {
  assetSummary,
  type AssetAction,
  authorizationError,
  authorizeAssetAccess,
} from '../drm/authorization.service';
import { logAssetAccess } from '../drm/drm.audit';
import { issueLicence } from '../drm/licence.service';
import { objectStorage } from '../drm/object-storage';
import { authContext, requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { consumeRateLimit } from '../middleware/rate-limit';

const HOUR_MS = 60 * 60 * 1000;
export const GRANT_LIMIT_PER_DEVICE_ASSET = 10;
export const GRANT_LIMIT_PER_USER = 300;
/** Shared with licence issuance (Task 8): one backstop for every kind of grant. */
export const USER_GRANTS_LIMITER = 'drm-grants-user';
export const DOWNLOAD_AUTHORIZATION_LIMITER = 'drm-download-authorizations';
export const DECRYPTION_AUTHORIZATION_LIMITER = 'drm-decryption-authorizations';

// Canonical form first: UUIDs compare case-insensitively in Postgres, so a rate-limit key
// built from raw input would let case variants of one id use separate buckets.
const assetParamSchema = z.object({
  assetId: z
    .string()
    .uuid('Not a valid asset id')
    .transform((id) => id.toLowerCase()),
});
const authorizationBodySchema = z.object({
  deviceId: z
    .string()
    .uuid('Not a valid device id')
    .transform((id) => id.toLowerCase()),
});

/** 10 per hour per user, device and asset, then the per-user backstop shared by every grant kind. */
async function enforceGrantLimits(
  req: Request,
  res: Response,
  limiter: string,
  action: AssetAction,
  ids: { userId: string; deviceId: string; assetId: string },
): Promise<void> {
  const perDeviceAsset = consumeRateLimit(
    limiter,
    `${ids.userId}:${ids.deviceId}:${ids.assetId}`,
    GRANT_LIMIT_PER_DEVICE_ASSET,
    HOUR_MS,
  );
  const limited = perDeviceAsset.allowed
    ? consumeRateLimit(USER_GRANTS_LIMITER, ids.userId, GRANT_LIMIT_PER_USER, HOUR_MS)
    : perDeviceAsset;
  if (limited.allowed) return;
  // Ids here are unvalidated against the database, so none are stored.
  await logAssetAccess({
    userId: ids.userId,
    assetId: null,
    deviceId: null,
    action,
    decision: 'deny',
    reasonCode: 'RATE_LIMITED',
    requestId: req.requestId,
  });
  res.set('Retry-After', String(limited.retryAfterSeconds));
  throw new AppError(429, 'Too many requests. Try again later.', 'RATE_LIMITED');
}

/** Authenticated: asks for a short-lived download grant. */
export const assetsRouter = Router();
assetsRouter.use(requireAuth);

assetsRouter.post('/:assetId/download-authorizations', async (req: Request, res: Response) => {
  const { assetId } = assetParamSchema.parse(req.params);
  const { deviceId } = authorizationBodySchema.parse(req.body);
  const { userId } = authContext(req);

  await enforceGrantLimits(req, res, DOWNLOAD_AUTHORIZATION_LIMITER, 'download_authorization', {
    userId,
    deviceId,
    assetId,
  });

  const decision = await authorizeAssetAccess({
    userId,
    assetId,
    deviceId,
    action: 'download_authorization',
    requestId: req.requestId,
  });
  if (!decision.ok) {
    throw authorizationError(decision);
  }

  const grant = await issueDownloadGrant({ userId, deviceId, assetId });
  const summary = assetSummary(decision.asset);
  res.set('Cache-Control', 'no-store').json({
    downloadUrl: `/api/v1/asset-downloads/${grant.token}`,
    expiresAt: grant.expiresAt,
    sizeBytes: summary.sizeBytes,
    sha256: summary.sha256,
  });
});

/** Authenticated: a signed, device-bound, 30-day licence carrying the wrapped decryption key. */
assetsRouter.post('/:assetId/decryption-authorizations', async (req: Request, res: Response) => {
  const { assetId } = assetParamSchema.parse(req.params);
  const { deviceId } = authorizationBodySchema.parse(req.body);
  const { userId } = authContext(req);

  await enforceGrantLimits(req, res, DECRYPTION_AUTHORIZATION_LIMITER, 'decryption_authorization', {
    userId,
    deviceId,
    assetId,
  });

  const decision = await authorizeAssetAccess({
    userId,
    assetId,
    deviceId,
    action: 'decryption_authorization',
    requestId: req.requestId,
  });
  if (!decision.ok) {
    throw authorizationError(decision);
  }

  const licence = await issueLicence(userId, assetId, deviceId, req.requestId);
  res.set('Cache-Control', 'no-store').json({ licence });
});

const NOT_FOUND = () => new AppError(404, 'Download not found', 'NOT_FOUND');

/**
 * Public: the unguessable token is the credential. Streams the ciphertext
 * (never plaintext) with range support so the app can resume.
 */
export const downloadsRouter = Router();

downloadsRouter.get('/:token', async (req: Request, res: Response) => {
  const token = String(req.params.token);
  const asset = await assetForToken(token);
  if (!asset?.object_key) throw NOT_FOUND();

  const size = await ciphertextSize(asset);
  if (size === null) throw NOT_FOUND();

  res.set({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ETag: `"${asset.ciphertext_sha256}"`,
    'X-Content-Type-Options': 'nosniff',
  });

  const range = parseRange(req.get('Range'), size);
  if (range === 'unsatisfiable') {
    res.status(416).set('Content-Range', `bytes */${size}`).end();
    return;
  }

  // Streamed, never buffered: memory stays flat however many grants are in flight. The range
  // is validated and clamped to the real size before storage sees it. HEAD reads nothing.
  // Opened before any length header is set, so a storage failure still gets a normal error body.
  const stream =
    req.method === 'HEAD'
      ? null
      : await objectStorage().createReadStream(asset.object_key, range ?? undefined);

  res
    .status(range ? 206 : 200)
    .set('Content-Length', String(range ? range.end - range.start + 1 : size));
  if (range) res.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  if (!stream) {
    res.end();
    return;
  }
  try {
    await pipeline(stream, res);
  } catch {
    // Client went away or the read failed mid-body: pipeline has destroyed both ends. Headers
    // are out, so there is nothing to send; never log here (the request path is a credential).
    res.destroy();
  }
});
