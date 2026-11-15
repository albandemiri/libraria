import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { isPgError, PG_UNIQUE_VIOLATION } from '../db/errors';
import { pool } from '../db/pool';
import { audit } from '../drm/drm.audit';
import { AppError } from '../middleware/errors';

/**
 * One-time invite links for a publisher's first logins. The token is 32 random bytes,
 * shown once in the link's URL fragment (so it never reaches a server or a log) and
 * stored only as its SHA-256.
 */

export const INVITE_DAYS = 7;
const TOKEN_BYTES = 32;
/** 32 bytes in base64url, unpadded. Anything else cannot be one of our tokens. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export type InviteInvalidReason = 'expired' | 'used' | 'revoked' | 'unknown';

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

export function inviteLink(token: string): string {
  return `${env.PORTAL_ORIGIN}/invite#token=${token}`;
}

export function invalidInvite(reason: InviteInvalidReason): AppError {
  return new AppError(410, 'This invite link is not valid', 'INVITE_INVALID', { reason });
}

export interface InviteRow {
  id: string;
  publisher_id: string;
  publisher_name: string;
  email: string;
  display_name: string | null;
  expired: boolean;
  accepted_at: Date | null;
  revoked_at: Date | null;
}

const INVITE_SELECT = `SELECT i.id, i.publisher_id, p.name AS publisher_name, i.email, i.display_name,
       (i.expires_at <= NOW()) AS expired, i.accepted_at, i.revoked_at
  FROM publisher_invites i
  JOIN publishers p ON p.id = i.publisher_id
 WHERE i.token_hash = $1`;

/** The refusal an invite deserves right now, or null when it can be used. */
function refusal(row: InviteRow | undefined): InviteInvalidReason | null {
  if (!row) return 'unknown';
  if (row.accepted_at) return 'used';
  if (row.revoked_at) return 'revoked';
  if (row.expired) return 'expired';
  return null;
}

/** What the accept page shows. Throws 410 INVITE_INVALID with the reason. */
export async function inspectInvite(token: string): Promise<{
  email: string;
  publisherName: string;
  displayName: string | null;
  /** The email already has an account, so accepting would fail with EMAIL_TAKEN. */
  emailTaken: boolean;
}> {
  if (!TOKEN_SHAPE.test(token)) throw invalidInvite('unknown');
  const { rows } = await pool.query<InviteRow>(INVITE_SELECT, [hashToken(token)]);
  const reason = refusal(rows[0]);
  if (reason) throw invalidInvite(reason);
  const invite = rows[0];
  const taken = await pool.query('SELECT 1 FROM users WHERE email = $1', [invite.email]);
  return {
    email: invite.email,
    publisherName: invite.publisher_name,
    displayName: invite.display_name,
    emailTaken: (taken.rowCount ?? 0) > 0,
  };
}

export interface AcceptedUserRow {
  id: string;
  email: string;
  display_name: string | null;
  role: 'publisher';
  publisher_id: string;
  created_at: Date;
}

/**
 * Creates the publisher login and uses the invite up, in one transaction. The invite
 * row is locked first, so two accepts of one token serialise: the second sees it used.
 * `passwordHash` is computed by the caller before the lock is taken.
 */
export async function acceptInvite(
  token: string,
  passwordHash: string,
  displayName: string,
): Promise<AcceptedUserRow> {
  if (!TOKEN_SHAPE.test(token)) throw invalidInvite('unknown');

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<InviteRow>(`${INVITE_SELECT} FOR UPDATE OF i`, [
      hashToken(token),
    ]);
    const reason = refusal(found.rows[0]);
    if (reason) throw invalidInvite(reason);
    const invite = found.rows[0];

    let user: AcceptedUserRow;
    try {
      const inserted = await client.query<AcceptedUserRow>(
        `INSERT INTO users (email, password_hash, display_name, role, publisher_id)
         VALUES ($1, $2, $3, 'publisher', $4)
         RETURNING id, email, display_name, role, publisher_id, created_at`,
        [invite.email, passwordHash, displayName, invite.publisher_id],
      );
      user = inserted.rows[0];
    } catch (error) {
      if (isPgError(error, PG_UNIQUE_VIOLATION)) {
        throw new AppError(409, 'An account with that email already exists', 'EMAIL_TAKEN');
      }
      throw error;
    }

    await client.query(
      'UPDATE publisher_invites SET accepted_at = NOW(), accepted_user_id = $2 WHERE id = $1',
      [invite.id, user.id],
    );
    await audit(
      {
        actorId: user.id,
        action: 'invite.accepted',
        resourceType: 'publisher_invite',
        resourceId: invite.id,
        metadata: { publisherId: invite.publisher_id, email: invite.email },
      },
      client,
    );
    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
