import { type Request, type Response, Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { generateToken, hashToken, INVITE_DAYS, inviteLink } from '../auth/invites';
import { rateInForceSql } from '../commerce/rates';
import { pool } from '../db/pool';
import { audit } from '../drm/drm.audit';
import { authContext } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { escapeLike } from '../reports/base';

/** Admin: publishers, their team and the invites that create the team. Mounted by admin.ts. */
export const adminPublishersRouter = Router();

const idParamSchema = z.object({ id: z.string().uuid('Not a valid id') });

/** A two-letter country code, stored upper-case. The portal offers a short list. */
const countrySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'Use a 2-letter country code')
  .transform((value) => value.toUpperCase());

const publisherFields = {
  name: z.string().trim().min(1, 'Name is required').max(200),
  contactEmail: z.email().max(254).trim(),
  country: countrySchema,
};

const createPublisherSchema = z.strictObject(publisherFields);
const updatePublisherSchema = z.strictObject({
  name: publisherFields.name.optional(),
  contactEmail: publisherFields.contactEmail.optional(),
  country: publisherFields.country.optional(),
});

// An empty ?q= means no filter.
const listQuerySchema = z.object({
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(200).optional()),
});

const inviteBodySchema = z.strictObject({
  email: z.email().max(254).trim(),
  displayName: z.string().trim().min(1).max(100).optional(),
});

interface PublisherRow {
  id: string;
  name: string;
  country: string | null;
  contact_email: string;
  current_rate_bps: number | null;
  book_count: number;
  created_at: Date;
}

const PUBLISHER_SELECT = `SELECT p.id, p.name, p.country, p.contact_email,
       ${rateInForceSql('p.id')} AS current_rate_bps,
       (SELECT COUNT(*)::int FROM books b WHERE b.publisher_id = p.id) AS book_count,
       p.created_at
  FROM publishers p`;

function formatPublisher(row: PublisherRow) {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    contactEmail: row.contact_email,
    currentRateBps: row.current_rate_bps,
    bookCount: row.book_count,
    createdAt: row.created_at,
  };
}

async function loadPublisher(
  id: string,
  db: Pick<PoolClient, 'query'> = pool,
): Promise<ReturnType<typeof formatPublisher> | null> {
  const { rows } = await db.query<PublisherRow>(`${PUBLISHER_SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ? formatPublisher(rows[0]) : null;
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

const notFound = (what: string) => new AppError(404, `${what} not found`, 'NOT_FOUND');

/** Publishing houses: the portal's admin picker (id, name) and the Platform list. */
adminPublishersRouter.get('/publishers', async (req: Request, res: Response) => {
  const { q } = listQuerySchema.parse(req.query);
  const { rows } = await pool.query<PublisherRow>(
    `${PUBLISHER_SELECT}
      WHERE ($1::text IS NULL OR p.name ILIKE $1)
      ORDER BY p.name, p.id`,
    [q ? `%${escapeLike(q)}%` : null],
  );
  res.json({ publishers: rows.map(formatPublisher) });
});

adminPublishersRouter.post('/publishers', async (req: Request, res: Response) => {
  const input = createPublisherSchema.parse(req.body);
  const publisher = await inTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO publishers (name, contact_email, country) VALUES ($1, $2, $3) RETURNING id`,
      [input.name, input.contactEmail, input.country],
    );
    const id = rows[0].id;
    await audit(
      {
        actorId: authContext(req).userId,
        action: 'publisher.created',
        resourceType: 'publisher',
        resourceId: id,
        metadata: { name: input.name, country: input.country },
      },
      client,
    );
    return loadPublisher(id, client);
  });
  res.status(201).json({ publisher });
});

adminPublishersRouter.patch('/publishers/:id', async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const input = updatePublisherSchema.parse(req.body);
  const changed = Object.keys(input);
  if (changed.length === 0) {
    throw new AppError(400, 'Nothing to update', 'NO_FIELDS_TO_UPDATE');
  }

  const publisher = await inTransaction(async (client) => {
    const current = await client.query<{
      name: string;
      contact_email: string;
      country: string | null;
    }>(
      // NO KEY UPDATE: does not block other rows referencing the publisher.
      'SELECT name, contact_email, country FROM publishers WHERE id = $1 FOR NO KEY UPDATE',
      [id],
    );
    const before = current.rows[0];
    if (!before) throw notFound('Publisher');

    await client.query(
      `UPDATE publishers
          SET name = COALESCE($2, name),
              contact_email = COALESCE($3, contact_email),
              country = COALESCE($4, country)
        WHERE id = $1`,
      [id, input.name ?? null, input.contactEmail ?? null, input.country ?? null],
    );
    await audit(
      {
        actorId: authContext(req).userId,
        action: 'publisher.updated',
        resourceType: 'publisher',
        resourceId: id,
        metadata: {
          changed,
          from: {
            ...(input.name !== undefined && { name: before.name }),
            ...(input.contactEmail !== undefined && { contactEmail: before.contact_email }),
            ...(input.country !== undefined && { country: before.country }),
          },
        },
      },
      client,
    );
    return loadPublisher(id, client);
  });
  res.json({ publisher });
});

adminPublishersRouter.get('/publishers/:id', async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.setHeader('Cache-Control', 'no-store');
  const publisher = await loadPublisher(id);
  if (!publisher) throw notFound('Publisher');

  const team = await pool.query<{
    id: string;
    email: string;
    display_name: string | null;
    status: string;
    created_at: Date;
  }>(
    `SELECT id, email, display_name, status, created_at
       FROM users WHERE publisher_id = $1 AND role = 'publisher'
      ORDER BY created_at, id`,
    [id],
  );
  // Only invites that can still be used: not accepted, not cancelled, not expired.
  const invites = await pool.query<{
    id: string;
    email: string;
    display_name: string | null;
    created_at: Date;
    expires_at: Date;
  }>(
    `SELECT id, email, display_name, created_at, expires_at
       FROM publisher_invites
      WHERE publisher_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC, id`,
    [id],
  );

  res.json({
    publisher,
    team: team.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      status: row.status,
      createdAt: row.created_at,
    })),
    invites: invites.rows.map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    })),
  });
});

/**
 * Creates an invite and returns its link, once. An open invite for the same publisher and
 * email is revoked first (re-issuing), so there is never more than one.
 */
adminPublishersRouter.post('/publishers/:id/invites', async (req: Request, res: Response) => {
  const { id: publisherId } = idParamSchema.parse(req.params);
  const input = inviteBodySchema.parse(req.body);
  const adminId = authContext(req).userId;
  const token = generateToken();

  const invite = await inTransaction(async (client) => {
    // Serialises concurrent invites for one publisher, so the revoke-then-insert below cannot
    // trip the one-open-invite index. NO KEY UPDATE does not block book inserts.
    const locked = await client.query('SELECT 1 FROM publishers WHERE id = $1 FOR NO KEY UPDATE', [
      publisherId,
    ]);
    if (locked.rowCount === 0) throw notFound('Publisher');

    // One email, one account: refuse early so the admin does not send a dead link.
    const taken = await client.query('SELECT 1 FROM users WHERE email = $1', [input.email]);
    if (taken.rowCount) {
      throw new AppError(409, 'An account with that email already exists', 'EMAIL_TAKEN');
    }

    const revoked = await client.query<{ id: string }>(
      `UPDATE publisher_invites SET revoked_at = NOW()
        WHERE publisher_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL
    RETURNING id`,
      [publisherId, input.email],
    );
    for (const old of revoked.rows) {
      await audit(
        {
          actorId: adminId,
          action: 'invite.revoked',
          resourceType: 'publisher_invite',
          resourceId: old.id,
          metadata: { publisherId, reason: 'reissued' },
        },
        client,
      );
    }

    const { rows } = await client.query<{
      id: string;
      email: string;
      display_name: string | null;
      created_at: Date;
      expires_at: Date;
    }>(
      `INSERT INTO publisher_invites
         (publisher_id, email, display_name, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, NOW() + make_interval(days => $5), $6)
       RETURNING id, email, display_name, created_at, expires_at`,
      [publisherId, input.email, input.displayName ?? null, hashToken(token), INVITE_DAYS, adminId],
    );
    await audit(
      {
        actorId: adminId,
        action: 'invite.created',
        resourceType: 'publisher_invite',
        resourceId: rows[0].id,
        metadata: { publisherId, email: input.email, expiresAt: rows[0].expires_at },
      },
      client,
    );
    return rows[0];
  });

  res.setHeader('Cache-Control', 'no-store');
  res.status(201).json({
    invite: {
      id: invite.id,
      email: invite.email,
      displayName: invite.display_name,
      createdAt: invite.created_at,
      expiresAt: invite.expires_at,
    },
    link: inviteLink(token),
  });
});

/** Cancels an invite. Cancelling one that is already cancelled succeeds and changes nothing. */
adminPublishersRouter.delete('/invites/:id', async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  await inTransaction(async (client) => {
    const { rows } = await client.query<{
      publisher_id: string;
      accepted_at: Date | null;
      revoked_at: Date | null;
    }>(
      'SELECT publisher_id, accepted_at, revoked_at FROM publisher_invites WHERE id = $1 FOR UPDATE',
      [id],
    );
    const invite = rows[0];
    if (!invite) throw notFound('Invite');
    if (invite.accepted_at) {
      throw new AppError(409, 'This invite was already accepted', 'INVITE_ACCEPTED');
    }
    if (invite.revoked_at) return;

    await client.query('UPDATE publisher_invites SET revoked_at = NOW() WHERE id = $1', [id]);
    await audit(
      {
        actorId: authContext(req).userId,
        action: 'invite.revoked',
        resourceType: 'publisher_invite',
        resourceId: id,
        metadata: { publisherId: invite.publisher_id, reason: 'cancelled' },
      },
      client,
    );
  });
  res.status(204).end();
});
