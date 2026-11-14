import type { PoolClient } from 'pg';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errors';
import { audit } from './drm.audit';
import { InvalidDeviceKeyError, parseDevicePublicKey } from './licence-crypto';

export const MAX_COUNTED_DEVICES = 5;
export const DEVICE_ACTIVE_DAYS = 90;
export const MAX_COUNTED_REMOVALS = 3;
export const REMOVAL_WINDOW_DAYS = 365;

export type DevicePlatform = 'ios' | 'android' | 'desktop';

export interface DeviceDto {
  id: string;
  platform: DevicePlatform;
  displayName: string;
  registeredAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  /** Occupies one of the user's device slots: not revoked, seen within 90 days. */
  counted: boolean;
}

interface DeviceRow {
  id: string;
  user_id: string;
  platform: DevicePlatform;
  display_name: string;
  registered_at: Date;
  last_seen_at: Date;
  licence_issued: boolean;
  revoked_at: Date | null;
  revocation_reason: string | null;
  counted: boolean;
}

type Db = Pick<PoolClient, 'query'>;

/** `counted` is evaluated by the database, so one clock decides everything. */
const DEVICE_COLUMNS = `id, user_id, platform, display_name, registered_at, last_seen_at,
  licence_issued, revoked_at, revocation_reason,
  (revoked_at IS NULL AND last_seen_at > NOW() - INTERVAL '${DEVICE_ACTIVE_DAYS} days') AS counted`;

function toDto(row: DeviceRow): DeviceDto {
  return {
    id: row.id,
    platform: row.platform,
    displayName: row.display_name,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    counted: row.counted,
  };
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Serialises every device change for one user; released at commit. NO KEY UPDATE, not
 * UPDATE: it must not block the FOR KEY SHARE that inserting a licence takes on the user
 * row, or touchDevice (user, then device) deadlocks with issuance (device, then user).
 * Lock order everywhere: user, then device.
 */
async function lockUser(client: Db, userId: string): Promise<void> {
  const { rowCount } = await client.query('SELECT 1 FROM users WHERE id = $1 FOR NO KEY UPDATE', [
    userId,
  ]);
  if (rowCount === 0) throw new AppError(404, 'User not found', 'NOT_FOUND');
}

async function countedRows(client: Db, userId: string): Promise<DeviceRow[]> {
  const { rows } = await client.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM devices
      WHERE user_id = $1 AND revoked_at IS NULL
        AND last_seen_at > NOW() - INTERVAL '${DEVICE_ACTIVE_DAYS} days'
      ORDER BY registered_at, id`,
    [userId],
  );
  return rows;
}

function limitReached(counted: DeviceRow[]): AppError {
  return new AppError(
    409,
    `At most ${MAX_COUNTED_DEVICES} devices can be active; remove one first`,
    'DEVICE_LIMIT_REACHED',
    { devices: counted.map(toDto) },
  );
}

export async function countedDevices(userId: string): Promise<DeviceDto[]> {
  return (await countedRows(pool, userId)).map(toDto);
}

/** The user's own, non-revoked devices (stale ones included, flagged not counted). */
export async function listDevices(userId: string): Promise<DeviceDto[]> {
  const { rows } = await pool.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM devices
      WHERE user_id = $1 AND revoked_at IS NULL ORDER BY registered_at, id`,
    [userId],
  );
  return rows.map(toDto);
}

/** Admin view: every device including revoked ones. */
export async function listAllDevices(userId: string): Promise<DeviceDto[]> {
  const { rows } = await pool.query<DeviceRow>(
    `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 ORDER BY registered_at, id`,
    [userId],
  );
  return rows.map(toDto);
}

export async function registerDevice(
  userId: string,
  input: { platform: DevicePlatform; displayName: string; publicKey: string },
): Promise<{ device: DeviceDto; created: boolean }> {
  try {
    parseDevicePublicKey(input.publicKey);
  } catch (error) {
    if (error instanceof InvalidDeviceKeyError) {
      throw new AppError(400, error.message, 'VALIDATION_FAILED');
    }
    throw error;
  }

  return inTransaction(async (client) => {
    await lockUser(client, userId);

    const existing = (
      await client.query<DeviceRow>(
        `SELECT ${DEVICE_COLUMNS} FROM devices WHERE user_id = $1 AND public_key_spki = $2`,
        [userId, input.publicKey],
      )
    ).rows[0];

    if (existing?.revoked_at && existing.revocation_reason === 'revoked_by_admin') {
      throw new AppError(403, 'This device has been revoked', 'FORBIDDEN');
    }

    // New, or returning after a self-removal or a lapse: takes a slot unless it already holds one.
    if (!existing?.counted) {
      const counted = await countedRows(client, userId);
      if (counted.length >= MAX_COUNTED_DEVICES) throw limitReached(counted);
    }

    if (existing) {
      const { rows } = await client.query<DeviceRow>(
        `UPDATE devices SET last_seen_at = NOW(), revoked_at = NULL, revocation_reason = NULL
          WHERE id = $1 RETURNING ${DEVICE_COLUMNS}`,
        [existing.id],
      );
      return { device: toDto(rows[0]), created: false };
    }

    const { rows } = await client.query<DeviceRow>(
      `INSERT INTO devices (user_id, platform, display_name, public_key_spki)
       VALUES ($1, $2, $3, $4) RETURNING ${DEVICE_COLUMNS}`,
      [userId, input.platform, input.displayName, input.publicKey],
    );
    await audit(
      {
        actorId: userId,
        action: 'device.registered',
        resourceType: 'device',
        resourceId: rows[0].id,
        metadata: { platform: input.platform, displayName: input.displayName },
      },
      client,
    );
    return { device: toDto(rows[0]), created: true };
  });
}

/**
 * Marks a device as seen. A device that had lapsed (90+ days) takes a slot
 * again, so it is refused when the user's slots are full.
 */
export async function touchDevice(deviceId: string): Promise<DeviceDto> {
  return inTransaction(async (client) => {
    const owner = await client.query<{ user_id: string }>(
      'SELECT user_id FROM devices WHERE id = $1',
      [deviceId],
    );
    if (owner.rowCount === 0) throw new AppError(404, 'Device not found', 'NOT_FOUND');
    await lockUser(client, owner.rows[0].user_id);

    // Re-read under the lock: the state may have changed while waiting for it.
    const device = (
      await client.query<DeviceRow>(`SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = $1`, [
        deviceId,
      ])
    ).rows[0];
    if (!device) throw new AppError(404, 'Device not found', 'NOT_FOUND');
    if (device.revoked_at) throw new AppError(403, 'This device has been revoked', 'FORBIDDEN');

    if (!device.counted) {
      const counted = await countedRows(client, device.user_id);
      if (counted.length >= MAX_COUNTED_DEVICES) throw limitReached(counted);
    }

    const { rows } = await client.query<DeviceRow>(
      `UPDATE devices SET last_seen_at = NOW() WHERE id = $1 RETURNING ${DEVICE_COLUMNS}`,
      [deviceId],
    );
    return toDto(rows[0]);
  });
}

/**
 * Revokes a device. A self removal counts toward the yearly cap only when the
 * device ever received a licence; an admin removal never counts.
 */
export async function removeDevice(
  userId: string,
  deviceId: string,
  actor: 'self' | 'admin',
  adminId?: string,
): Promise<void> {
  await inTransaction(async (client) => {
    await lockUser(client, userId);

    const device = (
      await client.query<DeviceRow>(
        `SELECT ${DEVICE_COLUMNS} FROM devices WHERE id = $1 AND user_id = $2`,
        [deviceId, userId],
      )
    ).rows[0];
    if (!device) throw new AppError(404, 'Device not found', 'NOT_FOUND');
    if (device.revoked_at) return;

    const countsTowardLimit = actor === 'self' && device.licence_issued;
    if (countsTowardLimit) {
      const { rows } = await client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM device_removals
          WHERE user_id = $1 AND removed_at > NOW() - INTERVAL '${REMOVAL_WINDOW_DAYS} days'`,
        [userId],
      );
      if (rows[0].n >= MAX_COUNTED_REMOVALS) {
        throw new AppError(
          409,
          `At most ${MAX_COUNTED_REMOVALS} devices with downloaded books can be removed per year`,
          'DEVICE_REMOVAL_LIMIT',
        );
      }
      await client.query('INSERT INTO device_removals (user_id, device_id) VALUES ($1, $2)', [
        userId,
        deviceId,
      ]);
    }

    await client.query(
      'UPDATE devices SET revoked_at = NOW(), revocation_reason = $2 WHERE id = $1',
      [deviceId, actor === 'self' ? 'removed_by_user' : 'revoked_by_admin'],
    );
    await audit(
      {
        actorId: actor === 'self' ? userId : (adminId ?? null),
        action: actor === 'self' ? 'device.removed' : 'device.revoked_by_admin',
        resourceType: 'device',
        resourceId: deviceId,
        metadata: { userId, counted: countsTowardLimit },
      },
      client,
    );
  });
}

/** Admin: forgives the user's past removals so they can remove devices again. */
export async function resetRemovals(userId: string, adminId: string): Promise<void> {
  await inTransaction(async (client) => {
    await lockUser(client, userId);
    const { rowCount } = await client.query('DELETE FROM device_removals WHERE user_id = $1', [
      userId,
    ]);
    await audit(
      {
        actorId: adminId,
        action: 'device.removals_reset',
        resourceType: 'user',
        resourceId: userId,
        metadata: { removalsCleared: rowCount ?? 0 },
      },
      client,
    );
  });
}
