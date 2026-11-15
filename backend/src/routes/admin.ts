import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { MAX_RATE_BPS } from '../commerce/commission';
import { listRates } from '../commerce/rates';
import { isPgError, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../db/errors';
import { pool } from '../db/pool';
import { invalidateAccountStatus } from '../auth/account-status';
import { retryAsset } from '../drm/asset-ingestion.service';
import { listAllDevices, removeDevice, resetRemovals } from '../drm/device.service';
import { audit } from '../drm/drm.audit';
import { authContext, requireAuth, requireRole } from '../middleware/auth';
import { escapeLike } from '../reports/base';
import { AppError } from '../middleware/errors';
import { adminPublishersRouter } from './admin-publishers';
import { adminReadersRouter } from './admin-readers';
import { adminReportsRouter } from './admin-reports';
import {
  BOOK_JOINS,
  BOOK_SELECT_COLUMNS,
  BOOK_STATUS_SQL,
  formatPublisherBook,
  type PublisherBookRow,
} from './publisher-books';
import { BOOK_SORTS, listPublisherBooksQuerySchema } from './publisher';

/** Platform administration. Admin accounts only. */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));
adminRouter.use(adminPublishersRouter);
adminRouter.use('/reports', adminReportsRouter);
adminRouter.use(adminReadersRouter);

const publisherParamSchema = z.object({ id: z.string().uuid('Not a valid publisher id') });

export const createRateSchema = z.object({
  rateBps: z.number().int().min(0).max(MAX_RATE_BPS),
  /** Defaults to now. May be in the future (a contract that starts later). */
  effectiveFrom: z.iso
    .datetime({ offset: true })
    .refine((value) => new Date(value).getUTCFullYear() >= 1970, {
      message: 'effectiveFrom must be 1970 or later',
    })
    .optional(),
  contractReference: z.string().trim().min(1).max(200).optional(),
});

async function requirePublisher(publisherId: string): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM publishers WHERE id = $1', [publisherId]);
  if (rowCount === 0) throw new AppError(404, 'Publisher not found', 'NOT_FOUND');
}

/**
 * Adds a contract rate. Rates are never edited: a new contract, or a
 * correction, is a new row. Sales already made keep their snapshotted rate.
 */
adminRouter.post('/publishers/:id/commission-rates', async (req: Request, res: Response) => {
  const { id: publisherId } = publisherParamSchema.parse(req.params);
  const input = createRateSchema.parse(req.body);

  let rateId: string;
  try {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO publisher_commission_rates
         (publisher_id, rate_bps, effective_from, contract_reference, created_by)
       VALUES ($1, $2, COALESCE($3::timestamptz, CURRENT_TIMESTAMP), $4, $5)
       RETURNING id`,
      [
        publisherId,
        input.rateBps,
        input.effectiveFrom ?? null,
        input.contractReference ?? null,
        authContext(req).userId,
      ],
    );
    rateId = rows[0].id;
  } catch (error) {
    if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
      throw new AppError(404, 'Publisher not found', 'NOT_FOUND');
    }
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      throw new AppError(
        409,
        'This publisher already has a rate starting at that time',
        'COMMISSION_RATE_EXISTS',
      );
    }
    throw error;
  }

  const rate = (await listRates(publisherId)).find((candidate) => candidate.id === rateId);
  res.status(201).json({ rate });
});

adminRouter.get('/publishers/:id/commission-rates', async (req: Request, res: Response) => {
  const { id: publisherId } = publisherParamSchema.parse(req.params);
  await requirePublisher(publisherId);
  res.json({ publisherId, rates: await listRates(publisherId) });
});

const assetParamSchema = z.object({ assetId: z.string().uuid('Not a valid asset id') });

/** Operator review: re-queues a failed ingestion whose original upload is still kept. */
adminRouter.post('/assets/:assetId/retry', async (req: Request, res: Response) => {
  const { assetId } = assetParamSchema.parse(req.params);
  const asset = await retryAsset(assetId, authContext(req).userId);
  res.status(202).json({
    asset: { id: asset.id, version: asset.version, state: asset.state },
  });
});

const userParamSchema = z.object({ id: z.string().uuid('Not a valid user id') });
const deviceParamSchema = z.object({ deviceId: z.string().uuid('Not a valid device id') });
const statusSchema = z.object({ status: z.enum(['active', 'suspended']) });

async function requireUser(userId: string): Promise<void> {
  const { rowCount } = await pool.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  if (rowCount === 0) throw new AppError(404, 'User not found', 'NOT_FOUND');
}

/** Suspends or reactivates an account. Takes effect on the user's next request. */
adminRouter.patch('/users/:id/status', async (req: Request, res: Response) => {
  const { id: userId } = userParamSchema.parse(req.params);
  const { status } = statusSchema.parse(req.body);
  const adminId = authContext(req).userId;
  if (userId === adminId) {
    throw new AppError(400, 'You cannot change your own account status', 'BAD_REQUEST');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ status: string }>(
      'SELECT status FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    if (current.rows.length === 0) throw new AppError(404, 'User not found', 'NOT_FOUND');
    await client.query('UPDATE users SET status = $2 WHERE id = $1', [userId, status]);
    await audit(
      {
        actorId: adminId,
        action: 'user.status_changed',
        resourceType: 'user',
        resourceId: userId,
        metadata: { from: current.rows[0].status, to: status },
      },
      client,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  invalidateAccountStatus(userId);
  res.json({ user: { id: userId, status } });
});

adminRouter.get('/users/:id/devices', async (req: Request, res: Response) => {
  const { id: userId } = userParamSchema.parse(req.params);
  await requireUser(userId);
  res.json({ devices: await listAllDevices(userId) });
});

adminRouter.delete('/devices/:deviceId', async (req: Request, res: Response) => {
  const { deviceId } = deviceParamSchema.parse(req.params);
  const { rows } = await pool.query<{ user_id: string }>(
    'SELECT user_id FROM devices WHERE id = $1',
    [deviceId],
  );
  if (rows.length === 0) throw new AppError(404, 'Device not found', 'NOT_FOUND');
  await removeDevice(rows[0].user_id, deviceId, 'admin', authContext(req).userId);
  res.status(204).end();
});

adminRouter.post('/users/:id/device-removals/reset', async (req: Request, res: Response) => {
  const { id: userId } = userParamSchema.parse(req.params);
  await resetRemovals(userId, authContext(req).userId);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Takedown
// ---------------------------------------------------------------------------

const bookParamSchema = z.object({ bookId: z.string().uuid('Not a valid book id') });
const withdrawSchema = z.object({ reason: z.string().trim().min(1).max(500) });

interface TakedownRow {
  id: string;
  withdrawn_at: Date | null;
  withdrawn_reason: string | null;
  is_available: boolean;
}

function takedownBody(row: TakedownRow) {
  return {
    book: {
      id: row.id,
      isAvailable: row.is_available,
      withdrawnAt: row.withdrawn_at,
      withdrawnReason: row.withdrawn_reason,
    },
  };
}

async function setWithdrawn(
  bookId: string,
  adminId: string,
  reason: string | null,
): Promise<TakedownRow> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<TakedownRow>(
      'SELECT id, withdrawn_at, withdrawn_reason, is_available FROM books WHERE id = $1 FOR UPDATE',
      [bookId],
    );
    const before = current.rows[0];
    if (!before) throw new AppError(404, 'Book not found', 'NOT_FOUND');

    const withdrawing = reason !== null;
    // Idempotent: repeating the current state changes and audits nothing.
    if (withdrawing === (before.withdrawn_at !== null)) {
      await client.query('COMMIT');
      return before;
    }

    // Withdrawing also unpublishes. Reinstating never republishes: the publisher does.
    const { rows } = await client.query<TakedownRow>(
      withdrawing
        ? `UPDATE books SET withdrawn_at = NOW(), withdrawn_reason = $2, is_available = FALSE
            WHERE id = $1
        RETURNING id, withdrawn_at, withdrawn_reason, is_available`
        : `UPDATE books SET withdrawn_at = NULL, withdrawn_reason = NULL
            WHERE id = $1 AND $2::text IS NULL
        RETURNING id, withdrawn_at, withdrawn_reason, is_available`,
      [bookId, reason],
    );
    await audit(
      {
        actorId: adminId,
        action: withdrawing ? 'book.withdrawn' : 'book.reinstated',
        resourceType: 'book',
        resourceId: bookId,
        metadata: withdrawing
          ? { reason }
          : { previousReason: before.withdrawn_reason, republishRequired: true },
      },
      client,
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Takes a book down: no new grants or licences; owners keep their library entry. */
adminRouter.post('/books/:bookId/withdraw', async (req: Request, res: Response) => {
  const { bookId } = bookParamSchema.parse(req.params);
  const { reason } = withdrawSchema.parse(req.body);
  res.json(takedownBody(await setWithdrawn(bookId, authContext(req).userId, reason)));
});

/** Lifts a takedown. The book stays unpublished until its publisher republishes it. */
adminRouter.post('/books/:bookId/reinstate', async (req: Request, res: Response) => {
  const { bookId } = bookParamSchema.parse(req.params);
  res.json({
    ...takedownBody(await setWithdrawn(bookId, authContext(req).userId, null)),
    note: 'The book is not republished automatically; its publisher must publish it again.',
  });
});

// ---------------------------------------------------------------------------
// Books across publishers
// ---------------------------------------------------------------------------

const adminBooksQuerySchema = listPublisherBooksQuerySchema.omit({ search: true }).extend({
  // An empty ?q= means no filter.
  q: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().min(1).max(200).optional()),
});

/** The publisher book payload for every publisher, with the publisher's name. */
adminRouter.get('/books', async (req: Request, res: Response) => {
  const { status, q, page, limit, publisherId, ...query } = adminBooksQuerySchema.parse(req.query);
  const sort = BOOK_SORTS[query.sort];
  const direction = (query.order ?? sort.defaultOrder) === 'asc' ? 'ASC' : 'DESC';

  const result = await pool.query<PublisherBookRow & { publisher_name: string }>(
    `SELECT ${BOOK_SELECT_COLUMNS},
            pub.name AS publisher_name,
            COUNT(*) OVER() AS total_count
       ${BOOK_JOINS}
       JOIN publishers pub ON pub.id = b.publisher_id
      WHERE ($1::uuid IS NULL OR b.publisher_id = $1)
        AND (($2::text = 'all' AND ${BOOK_STATUS_SQL} <> 'archived') OR ${BOOK_STATUS_SQL} = $2)
        AND ($3::text IS NULL OR b.title ILIKE $3 OR b.author ILIKE $3)
      ORDER BY ${sort.sql} ${direction}, b.id ${direction}
      LIMIT $4 OFFSET $5`,
    [publisherId ?? null, status, q ? `%${escapeLike(q)}%` : null, limit, (page - 1) * limit],
  );

  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
  res.json({
    books: result.rows.map((row) => ({
      ...formatPublisherBook(row),
      publisherName: row.publisher_name,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});
