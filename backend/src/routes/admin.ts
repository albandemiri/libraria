import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { MAX_RATE_BPS } from '../commerce/commission';
import { listRates } from '../commerce/rates';
import { isPgError, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../db/errors';
import { pool } from '../db/pool';
import { authContext, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errors';

/** Platform administration. Admin accounts only. */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

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

/** Publishing houses, for the portal's admin picker. */
adminRouter.get('/publishers', async (_req: Request, res: Response) => {
  const { rows } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM publishers ORDER BY name, id',
  );
  res.json({ publishers: rows });
});

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
