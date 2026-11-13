import { randomUUID } from 'node:crypto';
import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { isPgError, PG_UNIQUE_VIOLATION } from '../db/errors';
import { env } from '../config/env';
import { pool, withTransaction } from '../db/pool';
import { authContext, requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';

export const transactionsRouter = Router();

// All transactions endpoints require authentication.
transactionsRouter.use(requireAuth);

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const checkoutSchema = z.object({
  bookId: z.string().uuid('Not a valid book id'),
  // Optional client token for simulated or real payment gateways (e.g., Stripe PaymentMethod)
  paymentMethodToken: z.string().trim().min(1).max(255).optional(),
  // Client-supplied idempotency key
  idempotencyKey: z.string().trim().min(1).max(100).optional(),
});

export const transactionIdParamSchema = z.object({
  id: z.string().uuid('Not a valid transaction id'),
});

interface TransactionRow {
  id: string;
  user_id: string;
  book_id: string;
  amount_cents: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  payment_gateway_ref: string | null;
  created_at: Date;
  updated_at: Date;
  book_title: string;
  book_author: string;
  book_cover_url: string | null;
  publisher_id: string;
  publisher_name: string;
  total_count?: string;
}

interface BookRow {
  id: string;
  title: string;
  author: string;
  price_cents: number;
  currency: string;
  is_available: boolean;
  cover_image_url: string | null;
  publisher_id: string;
  publisher_name: string;
}

function publicTransaction(row: TransactionRow) {
  return {
    id: row.id,
    status: row.status,
    amount: {
      amountCents: row.amount_cents,
      currency: row.currency,
    },
    paymentGatewayRef: row.payment_gateway_ref,
    createdAt: row.created_at,
    book: {
      id: row.book_id,
      title: row.book_title,
      author: row.book_author,
      coverImageUrl: row.book_cover_url,
      publisher: {
        id: row.publisher_id,
        name: row.publisher_name,
      },
    },
  };
}

/**
 * SIMULATED CHECKOUT — development and test only.
 *
 * Marks the transaction completed and grants library access without any
 * payment provider. This is exactly what spec section 7.2 forbids in
 * production, so it only runs when PAYMENTS_MODE=simulated, which the env
 * loader refuses to accept when NODE_ENV=production. The Commerce MVP
 * (spec 7.1) replaces this with pending checkout sessions that complete only
 * on a verified provider webhook.
 */
transactionsRouter.post('/', async (req: Request, res: Response) => {
  if (env.PAYMENTS_MODE !== 'simulated') {
    throw new AppError(503, 'Purchasing is not available yet', 'PAYMENTS_UNAVAILABLE');
  }

  const { userId } = authContext(req);
  const { bookId, idempotencyKey } = checkoutSchema.parse(req.body);

  // 1. Check if the user already owns this title
  const existingOwnership = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM user_libraries
        WHERE user_id = $1 AND book_id = $2
     ) AS exists`,
    [userId, bookId],
  );

  if (existingOwnership.rows[0]?.exists) {
    throw new AppError(409, 'You already own this book', 'ALREADY_OWNED');
  }

  // 2. Fetch the book and ensure it is listed in the storefront
  const bookResult = await pool.query<BookRow>(
    `SELECT b.id,
            b.title,
            b.author,
            b.price_cents,
            b.currency,
            b.is_available,
            b.cover_image_url,
            b.publisher_id,
            p.name AS publisher_name
       FROM books b
       JOIN publishers p ON p.id = b.publisher_id
      WHERE b.id = $1`,
    [bookId],
  );

  const book = bookResult.rows[0];
  if (!book?.is_available) {
    throw new AppError(404, 'Book not found or unavailable for purchase', 'NOT_FOUND');
  }

  // 3. Atomically record the transaction and grant library access
  // The `sim_` prefix makes simulated rows unmistakable in the database. The
  // client key is scoped to the user so two users choosing the same key do not
  // collide on the global unique constraint.
  const gatewayRef = idempotencyKey ? `sim_${userId}_${idempotencyKey}` : `sim_${randomUUID()}`;

  try {
    const transaction = await withTransaction(async (client) => {
      // Create completed transaction
      const txnResult = await client.query<{
        id: string;
        amount_cents: number;
        currency: string;
        status: 'completed';
        payment_gateway_ref: string;
        created_at: Date;
      }>(
        `INSERT INTO transactions (user_id, book_id, amount_cents, currency, status, payment_gateway_ref)
         VALUES ($1, $2, $3, $4, 'completed', $5)
         RETURNING id, amount_cents, currency, status, payment_gateway_ref, created_at`,
        [userId, book.id, book.price_cents, book.currency, gatewayRef],
      );

      const txn = txnResult.rows[0];

      // Insert into user_libraries to grant digital ownership
      await client.query(
        `INSERT INTO user_libraries (user_id, book_id, transaction_id, acquired_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, book_id) DO NOTHING`,
        [userId, book.id, txn.id, txn.created_at],
      );

      return txn;
    });

    res.status(201).json({
      transaction: {
        id: transaction.id,
        status: transaction.status,
        amount: {
          amountCents: transaction.amount_cents,
          currency: transaction.currency,
        },
        paymentGatewayRef: transaction.payment_gateway_ref,
        createdAt: transaction.created_at,
        book: {
          id: book.id,
          title: book.title,
          author: book.author,
          coverImageUrl: book.cover_image_url,
          publisher: {
            id: book.publisher_id,
            name: book.publisher_name,
          },
        },
      },
    });
  } catch (error) {
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      throw new AppError(
        409,
        'A purchase for this title is already completed or processing',
        'ALREADY_OWNED',
      );
    }
    throw error;
  }
});

/**
 * Lists the authenticated user's purchase history.
 */
transactionsRouter.get('/', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { page, limit } = listTransactionsQuerySchema.parse(req.query);
  const offset = (page - 1) * limit;

  const result = await pool.query<TransactionRow>(
    `SELECT t.id,
            t.user_id,
            t.book_id,
            t.amount_cents,
            t.currency,
            t.status,
            t.payment_gateway_ref,
            t.created_at,
            t.updated_at,
            b.title AS book_title,
            b.author AS book_author,
            b.cover_image_url AS book_cover_url,
            b.publisher_id,
            p.name AS publisher_name,
            COUNT(*) OVER() AS total_count
       FROM transactions t
       JOIN books b ON b.id = t.book_id
       JOIN publishers p ON p.id = b.publisher_id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  res.json({
    transactions: result.rows.map(publicTransaction),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * Fetches an individual purchase receipt.
 */
transactionsRouter.get('/:id', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { id } = transactionIdParamSchema.parse(req.params);

  const result = await pool.query<TransactionRow>(
    `SELECT t.id,
            t.user_id,
            t.book_id,
            t.amount_cents,
            t.currency,
            t.status,
            t.payment_gateway_ref,
            t.created_at,
            t.updated_at,
            b.title AS book_title,
            b.author AS book_author,
            b.cover_image_url AS book_cover_url,
            b.publisher_id,
            p.name AS publisher_name
       FROM transactions t
       JOIN books b ON b.id = t.book_id
       JOIN publishers p ON p.id = b.publisher_id
      WHERE t.id = $1 AND t.user_id = $2`,
    [id, userId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'Transaction not found', 'NOT_FOUND');
  }

  res.json({ transaction: publicTransaction(row) });
});
