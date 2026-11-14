import type { Pool, PoolClient } from 'pg';
import { pool } from '../db/pool';

type Db = Pick<Pool | PoolClient, 'query'>;

export interface AuditEvent {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata?: Record<string, unknown>;
}

/** Keys that could carry key material, tokens or signatures never reach the audit log. */
const SECRET_KEY = /token|key|dek|secret|signature|wrapped/i;

/** Returns a copy without any secret-looking key, at any depth. */
export function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const clean: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!SECRET_KEY.test(key)) clean[key] = redactMetadata(inner);
    }
    return clean;
  }
  return value;
}

/** Records an operator/publisher action. Pass a client to join the caller's transaction. */
export async function audit(event: AuditEvent, db: Db = pool): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (actor_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      event.actorId,
      event.action,
      event.resourceType,
      event.resourceId,
      JSON.stringify(redactMetadata(event.metadata ?? {})),
    ],
  );
}

export interface AssetAccessEntry {
  userId: string | null;
  assetId: string | null;
  deviceId: string | null;
  action: 'download_authorization' | 'decryption_authorization';
  decision: 'allow' | 'deny';
  /** Internal authorization reason; clients never see it. */
  reasonCode?: string | null;
  requestId?: string | null;
}

/** One row per download or decryption authorization decision. */
export async function logAssetAccess(entry: AssetAccessEntry, db: Db = pool): Promise<void> {
  await db.query(
    `INSERT INTO asset_access_logs
       (user_id, asset_id, device_id, action, decision, reason_code, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.userId,
      entry.assetId,
      entry.deviceId,
      entry.action,
      entry.decision,
      entry.reasonCode ?? null,
      entry.requestId ?? null,
    ],
  );
}
