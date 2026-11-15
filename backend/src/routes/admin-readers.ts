import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { REMOVAL_WINDOW_DAYS, listAllDevices } from '../drm/device.service';
import { audit } from '../drm/drm.audit';
import { authContext } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { escapeLike } from '../reports/base';

/** Admin: reader support lookups. Read-only; reader accounts only. Mounted by admin.ts. */
export const adminReadersRouter = Router();

/** A prefix shorter than this could list half the readers; an exact email is always fine. */
const MIN_PREFIX = 3;
const MAX_RESULTS = 20;

const searchSchema = z.object({ q: z.string().trim().min(1).max(254) });
const idParamSchema = z.object({ id: z.string().uuid('Not a valid user id') });

interface ReaderRow {
  id: string;
  email: string;
  display_name: string | null;
  status: 'active' | 'suspended';
  created_at: Date;
}

const READER_COLUMNS = 'id, email, display_name, status, created_at';

function formatReader(row: ReaderRow) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status,
    createdAt: row.created_at,
  };
}

adminReadersRouter.get('/readers', async (req: Request, res: Response) => {
  const { q } = searchSchema.parse(req.query);
  res.setHeader('Cache-Control', 'no-store');

  // A prefix search always includes the exact match. Below the minimum, only an exact
  // email is served, so a short query cannot be used to browse the reader list.
  // email is citext: equality and ILIKE are both case-insensitive.
  if (q.length < MIN_PREFIX) {
    const exact = await pool.query<ReaderRow>(
      `SELECT ${READER_COLUMNS} FROM users WHERE role = 'reader' AND email = $1`,
      [q],
    );
    if (exact.rows.length === 0) {
      throw new AppError(
        400,
        `Type at least ${MIN_PREFIX} characters, or a full email address`,
        'VALIDATION_FAILED',
      );
    }
    res.json({ readers: exact.rows.map(formatReader) });
    return;
  }

  const { rows } = await pool.query<ReaderRow>(
    `SELECT ${READER_COLUMNS} FROM users
      WHERE role = 'reader' AND email ILIKE $1
      ORDER BY email, id
      LIMIT ${MAX_RESULTS}`,
    [`${escapeLike(q)}%`],
  );
  res.json({ readers: rows.map(formatReader) });
});

adminReadersRouter.get('/readers/:id', async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  res.setHeader('Cache-Control', 'no-store');
  const { rows } = await pool.query<ReaderRow>(
    `SELECT ${READER_COLUMNS} FROM users WHERE id = $1 AND role = 'reader'`,
    [id],
  );
  if (rows.length === 0) throw new AppError(404, 'Reader not found', 'NOT_FOUND');

  // Looking at an account's details is itself an auditable act.
  await audit({
    actorId: authContext(req).userId,
    action: 'reader.viewed',
    resourceType: 'user',
    resourceId: id,
  });

  const owned = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM entitlements WHERE user_id = $1 AND status = 'active'`,
    [id],
  );
  const removals = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM device_removals
      WHERE user_id = $1 AND removed_at > NOW() - INTERVAL '${REMOVAL_WINDOW_DAYS} days'`,
    [id],
  );
  res.json({
    reader: formatReader(rows[0]),
    booksOwned: owned.rows[0].n,
    devices: await listAllDevices(id),
    removalsThisYear: removals.rows[0].n,
  });
});
