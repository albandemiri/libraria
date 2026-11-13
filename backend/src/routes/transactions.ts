import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { getReceipt, listReceipts } from '../commerce/queries';
import { activeProvider } from '../commerce/providers';
import { createCheckout, MAX_CHECKOUT_ITEMS } from '../commerce/service';
import { authContext, requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';

// ---------------------------------------------------------------------------
// Checkout sessions (spec 6, 7.1)
// ---------------------------------------------------------------------------

export const checkoutRouter = Router();
checkoutRouter.use(requireAuth);

export const checkoutSchema = z.object({
  bookIds: z
    .array(z.string().uuid('Not a valid book id'))
    .min(1, 'Choose at least one book')
    .max(MAX_CHECKOUT_ITEMS, `At most ${MAX_CHECKOUT_ITEMS} books per checkout`),
  // Retrying with the same key returns the same checkout instead of a new one.
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

/**
 * Starts a purchase: creates a pending transaction priced from the catalogue
 * and a provider checkout. Nothing is granted here; the book appears in the
 * library only after the provider's signed webhook confirms payment.
 */
checkoutRouter.post('/', async (req: Request, res: Response) => {
  const provider = activeProvider();
  if (!provider) {
    throw new AppError(503, 'Purchasing is not available yet', 'PAYMENTS_UNAVAILABLE');
  }

  const { userId } = authContext(req);
  const { bookIds, idempotencyKey } = checkoutSchema.parse(req.body);

  const { transactionId, created } = await createCheckout(provider, {
    userId,
    bookIds,
    idempotencyKey,
  });

  const receipt = await getReceipt(userId, transactionId);
  res.status(created ? 201 : 200).json({
    transaction: receipt,
    checkout: { provider: provider.name, url: receipt?.checkoutUrl ?? null },
  });
});

// ---------------------------------------------------------------------------
// Purchase history
// ---------------------------------------------------------------------------

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const transactionIdParamSchema = z.object({
  id: z.string().uuid('Not a valid transaction id'),
});

transactionsRouter.get('/', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { page, limit } = listTransactionsQuerySchema.parse(req.query);

  const { receipts, total } = await listReceipts(userId, { limit, offset: (page - 1) * limit });

  res.json({
    transactions: receipts,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

/** A receipt; also how the app polls a pending checkout until it is paid. */
transactionsRouter.get('/:id', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { id } = transactionIdParamSchema.parse(req.params);

  const receipt = await getReceipt(userId, id);
  if (!receipt) {
    throw new AppError(404, 'Transaction not found', 'NOT_FOUND');
  }

  res.json({ transaction: receipt });
});
