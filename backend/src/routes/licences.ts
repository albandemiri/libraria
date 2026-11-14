import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { accountStatus } from '../auth/account-status';
import { pool } from '../db/pool';
import { accessDenied } from '../drm/authorization.service';
import { DEVICE_ACTIVE_DAYS } from '../drm/device.service';
import { licenceSigningKeyId, licenceSigningPublicKeyPem } from '../drm/licence-crypto';
import { licenceStatuses } from '../drm/licence.service';
import { authContext, requireAuthAllowSuspended } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { consumeRateLimit } from '../middleware/rate-limit';

const HOUR_MS = 60 * 60 * 1000;
export const STATUS_LIMIT_PER_DEVICE = 60;
export const STATUS_LIMITER = 'drm-licence-status';

// Canonical (lowercase) form first: UUIDs compare case-insensitively in Postgres, and
// limiter keys built from raw input would give case variants separate buckets.
const canonicalUuid = (label: string) =>
  z
    .string()
    .uuid(`Not a valid ${label}`)
    .transform((id) => id.toLowerCase());

const statusBodySchema = z.object({
  deviceId: canonicalUuid('device id'),
  licenceIds: z.array(canonicalUuid('licence id')).min(1).max(500),
});

/** Authenticated: the app's periodic check-in for its stored licences. */
export const licencesRouter = Router();
// A suspended account is let in: its check-in must learn that its licences are `revoked`.
licencesRouter.use(requireAuthAllowSuspended);

licencesRouter.post('/status', async (req: Request, res: Response) => {
  const { deviceId, licenceIds } = statusBodySchema.parse(req.body);
  const { userId } = authContext(req);

  // Keyed on the caller too, so nobody can burn another user's device budget.
  const limited = consumeRateLimit(
    STATUS_LIMITER,
    `${userId}:${deviceId}`,
    STATUS_LIMIT_PER_DEVICE,
    HOUR_MS,
  );
  if (!limited.allowed) {
    res.set('Retry-After', String(limited.retryAfterSeconds));
    throw new AppError(429, 'Too many requests. Try again later.', 'RATE_LIMITED');
  }

  // A device that is not the caller's looks exactly like one that does not exist.
  const owned = await pool.query('SELECT 1 FROM devices WHERE id = $1 AND user_id = $2', [
    deviceId,
    userId,
  ]);
  if (owned.rows.length === 0) throw accessDenied();

  // The check-in is device activity: it keeps a counted device inside the 90-day window.
  // A revoked or lapsed device is left alone (it still gets its statuses): a lapsed one
  // re-enters the count only through a grant, where touchDevice enforces the slot limit.
  // A suspended account's device is not refreshed: it is not active.
  if ((await accountStatus(userId)) === 'active') {
    await pool.query(
      `UPDATE devices SET last_seen_at = NOW()
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
          AND last_seen_at > NOW() - INTERVAL '${DEVICE_ACTIVE_DAYS} days'`,
      [deviceId, userId],
    );
  }

  res
    .set('Cache-Control', 'no-store')
    .json({ licences: await licenceStatuses(userId, deviceId, licenceIds) });
});

/** Public: the key apps use to verify licence signatures. */
export const drmRouter = Router();

drmRouter.get('/licence-signing-key', (_req: Request, res: Response) => {
  res.json({
    algorithm: 'Ed25519',
    kid: licenceSigningKeyId(),
    publicKeyPem: licenceSigningPublicKeyPem(),
  });
});
