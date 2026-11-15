import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { listRates } from '../commerce/rates';
import { SUPPORTED_CURRENCIES } from '../commerce/service';
import { pool } from '../db/pool';
import { requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { assetsRouter } from './assets-publisher';
import { deleteBook } from './book-lifecycle';
import { coverRouter } from './covers-publisher';
import {
  BOOK_JOINS,
  BOOK_SELECT_COLUMNS,
  BOOK_STATUS_SQL,
  formatPublisherBook,
  loadPublisherBook,
  type PublisherBookRow,
} from './publisher-books';
import {
  bookWriteScope,
  publisherScopeQuerySchema,
  resolvePublisherScope,
  tenantFilter,
} from './publisher-scope';
import { escapeLike } from '../reports/base';
import { reportsRouter } from './reports';

/** Book languages accepted at launch (ISO 639-1). Albanian is the default. */
export const BOOK_LANGUAGES = ['sq', 'en'] as const;

export { publisherScopeQuerySchema, resolvePublisherScope };

export const publisherRouter = Router();

// Publisher endpoints require an authenticated user with 'publisher' or 'admin' role.
publisherRouter.use(requireAuth, requireRole('publisher', 'admin'));
publisherRouter.use('/reports', reportsRouter);
publisherRouter.use('/books/:bookId/assets', assetsRouter);
publisherRouter.use('/books/:bookId/cover', coverRouter);

export const listPublisherBooksQuerySchema = z.object({
  // `all|published|draft` predate the derived status; they select by the same
  // derived value shown on each book.
  status: z
    .enum(['all', 'draft', 'processing', 'ready', 'published', 'archived', 'withdrawn'])
    .default('all'),
  sort: z.enum(['updated', 'title', 'copies', 'earnings', 'price']).default('updated'),
  order: z.enum(['asc', 'desc']).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Admin-only filter; ignored for publisher accounts, which are always scoped.
  publisherId: z.string().uuid('Not a valid publisher id').optional(),
});

export const bookIdParamSchema = z.object({
  id: z.string().uuid('Not a valid book id'),
});

const isbn13Regex = /^[0-9]{13}$/;

export const createBookSchema = z
  .strictObject({
    title: z.string().trim().min(1, 'Title is required').max(500),
    author: z.string().trim().min(1, 'Author is required').max(300),
    isbn13: z
      .string()
      .trim()
      .regex(isbn13Regex, 'ISBN-13 must be exactly 13 numeric digits without hyphens')
      .nullable()
      .optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    genre: z.string().trim().min(1, 'Genre is required').max(100),
    // Libraria is an Albanian ebook marketplace: Albanian first, English for now.
    language: z.enum(BOOK_LANGUAGES).default('sq'),
    priceCents: z.coerce.number().int().min(0, 'Price cannot be negative'),
    // EUR only at launch (see SUPPORTED_CURRENCIES).
    currency: z.enum(SUPPORTED_CURRENCIES).default('EUR'),
    mediaType: z.enum(['ebook', 'audiobook']).default('ebook'),
    durationSeconds: z.coerce.number().int().positive().nullable().optional(),
    publisherId: z.string().uuid().optional(),
  })
  .refine((data) => data.mediaType === 'audiobook' || data.durationSeconds == null, {
    message: 'durationSeconds is only allowed for audiobooks',
    path: ['durationSeconds'],
  });

export const updateBookSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(500).optional(),
    author: z.string().trim().min(1).max(300).optional(),
    isbn13: z
      .string()
      .trim()
      .regex(isbn13Regex, 'ISBN-13 must be exactly 13 numeric digits without hyphens')
      .nullable()
      .optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    genre: z.string().trim().min(1).max(100).optional(),
    language: z.enum(BOOK_LANGUAGES).optional(),
    priceCents: z.coerce.number().int().min(0).optional(),
    currency: z.enum(SUPPORTED_CURRENCIES).optional(),
    mediaType: z.enum(['ebook', 'audiobook']).optional(),
    durationSeconds: z.coerce.number().int().positive().nullable().optional(),
  })
  .refine((data) => data.mediaType === 'audiobook' || data.durationSeconds == null, {
    message: 'durationSeconds is only allowed for audiobooks',
    path: ['durationSeconds'],
  });

/**
 * Whitelisted ORDER BY expressions and their natural direction; user input
 * only ever selects a key, never reaches the SQL text.
 */
const BOOK_SORTS = {
  updated: { sql: 'b.updated_at', defaultOrder: 'desc' },
  title: { sql: 'LOWER(b.title)', defaultOrder: 'asc' },
  copies: { sql: 'COALESCE(s.sales_count, 0)', defaultOrder: 'desc' },
  earnings: { sql: 'COALESCE(s.earnings, 0)', defaultOrder: 'desc' },
  price: { sql: 'b.price_cents', defaultOrder: 'desc' },
} as const;

/**
 * Lists books belonging to the publisher portal account (drafts & published).
 */
publisherRouter.get('/books', async (req: Request, res: Response) => {
  const query = listPublisherBooksQuerySchema.parse(req.query);
  const { status, search, page, limit } = query;
  const sort = BOOK_SORTS[query.sort];
  const direction = (query.order ?? sort.defaultOrder) === 'asc' ? 'ASC' : 'DESC';
  const publisherId = tenantFilter(req) ?? query.publisherId ?? null;
  const offset = (page - 1) * limit;

  const result = await pool.query<PublisherBookRow>(
    `SELECT ${BOOK_SELECT_COLUMNS},
            COUNT(*) OVER() AS total_count
       ${BOOK_JOINS}
      WHERE ($1::uuid IS NULL OR b.publisher_id = $1)
        AND (($2::text = 'all' AND ${BOOK_STATUS_SQL} <> 'archived') OR ${BOOK_STATUS_SQL} = $2)
        AND ($3::text IS NULL OR b.title ILIKE $3 OR b.author ILIKE $3)
      ORDER BY ${sort.sql} ${direction}, b.id ${direction}
      LIMIT $4 OFFSET $5`,
    [publisherId, status, search ? `%${escapeLike(search)}%` : null, limit, offset],
  );

  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  res.json({
    books: result.rows.map(formatPublisherBook),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * Overall sales and title metrics for the publisher dashboard.
 */
publisherRouter.get('/stats', async (req: Request, res: Response) => {
  const publisherId = resolvePublisherScope(
    req,
    publisherScopeQuerySchema.parse(req.query).publisherId,
  );

  const statsResult = await pool.query<{
    total_titles: string;
    published_titles: string;
    draft_titles: string;
    total_copies_sold: string;
    total_revenue_cents: string;
    total_earnings_cents: string;
    total_platform_commission_cents: string;
  }>(
    `SELECT COUNT(b.id) FILTER (WHERE b.archived_at IS NULL)::int AS total_titles,
            COUNT(b.id) FILTER (WHERE b.is_available)::int AS published_titles,
            COUNT(b.id) FILTER (WHERE NOT b.is_available AND b.archived_at IS NULL)::int AS draft_titles,
            COALESCE(SUM(s.sales_count), 0)::bigint AS total_copies_sold,
            COALESCE(SUM(s.total_revenue), 0)::bigint AS total_revenue_cents,
            COALESCE(SUM(s.earnings), 0)::bigint AS total_earnings_cents,
            COALESCE(SUM(s.commission), 0)::bigint AS total_platform_commission_cents
       FROM books b
       LEFT JOIN (SELECT book_id, sales_count, gross_revenue_cents AS total_revenue,
                         publisher_earnings_cents AS earnings,
                         platform_commission_cents AS commission
                    FROM book_sales) s ON s.book_id = b.id
      WHERE b.publisher_id = $1`,
    [publisherId],
  );

  const row = statsResult.rows[0];

  res.json({
    publisherId,
    stats: {
      totalTitles: Number(row?.total_titles ?? 0),
      publishedTitles: Number(row?.published_titles ?? 0),
      draftTitles: Number(row?.draft_titles ?? 0),
      totalCopiesSold: Number(row?.total_copies_sold ?? 0),
      totalRevenueCents: Number(row?.total_revenue_cents ?? 0),
      // Publisher's and Libraria's shares of net, after refund reversals.
      totalEarningsCents: Number(row?.total_earnings_cents ?? 0),
      totalPlatformCommissionCents: Number(row?.total_platform_commission_cents ?? 0),
    },
  });
});

/**
 * The publisher's commission contract: the rate in force and its history.
 * Read-only; rates are set by Libraria admins.
 */
publisherRouter.get('/contract', async (req: Request, res: Response) => {
  const publisherId = resolvePublisherScope(
    req,
    publisherScopeQuerySchema.parse(req.query).publisherId,
  );
  // Only reachable for admins naming a publisher; staff are always linked.
  const { rowCount } = await pool.query('SELECT 1 FROM publishers WHERE id = $1', [publisherId]);
  if (rowCount === 0) throw new AppError(404, 'Publisher not found', 'NOT_FOUND');

  const history = await listRates(publisherId);
  res.json({
    publisherId,
    current: history.find((rate) => rate.inForce) ?? null,
    history,
  });
});

/** Every write answers with the same payload as the list and the single book. */
async function respondBook(id: string, scope: string | null) {
  const book = await loadPublisherBook(id, scope);
  if (!book) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  return formatPublisherBook(book);
}

/**
 * Creates a new title in draft status (`is_available = false`).
 */
publisherRouter.post('/books', async (req: Request, res: Response) => {
  const input = createBookSchema.parse(req.body);
  const publisherId = resolvePublisherScope(req, input.publisherId);

  const result = await pool.query<PublisherBookRow>(
    `INSERT INTO books (
       publisher_id,
       title,
       author,
       isbn13,
       description,
       genre,
       language,
       price_cents,
       currency,
       media_type,
       duration_seconds,
       is_available
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE)
     RETURNING id`,
    [
      publisherId,
      input.title,
      input.author,
      input.isbn13 ?? null,
      input.description ?? null,
      input.genre,
      input.language,
      input.priceCents,
      input.currency,
      input.mediaType,
      input.durationSeconds ?? null,
    ],
  );

  res.status(201).json({ book: await respondBook(result.rows[0].id, publisherId) });
});

/**
 * Retrieves a single book's publisher details.
 */
publisherRouter.get('/books/:id', async (req: Request, res: Response) => {
  const { id } = bookIdParamSchema.parse(req.params);

  const book = await loadPublisherBook(id, bookWriteScope(req));
  if (!book) {
    throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  }

  res.json({ book: formatPublisherBook(book) });
});

/**
 * Updates a book draft or existing title's metadata.
 */
publisherRouter.patch('/books/:id', async (req: Request, res: Response) => {
  const { id } = bookIdParamSchema.parse(req.params);
  const input = updateBookSchema.parse(req.body);

  const publisherId = bookWriteScope(req);

  const result = await pool.query<PublisherBookRow>(
    `UPDATE books
        SET title = COALESCE($1, title),
            author = COALESCE($2, author),
            isbn13 = CASE WHEN $13::boolean THEN $3::text ELSE isbn13 END,
            description = CASE WHEN $14::boolean THEN $4::text ELSE description END,
            genre = COALESCE($5, genre),
            language = COALESCE($6, language),
            price_cents = COALESCE($7, price_cents),
            currency = COALESCE($8, currency),
            media_type = COALESCE($9, media_type),
            duration_seconds = CASE WHEN $15::boolean THEN $10::int ELSE duration_seconds END
      WHERE id = $11
        AND ($12::uuid IS NULL OR publisher_id = $12)
        AND archived_at IS NULL
  RETURNING id`,
    [
      input.title ?? null,
      input.author ?? null,
      input.isbn13 === undefined ? null : input.isbn13,
      input.description === undefined ? null : input.description,
      input.genre ?? null,
      input.language ?? null,
      input.priceCents ?? null,
      input.currency ?? null,
      input.mediaType ?? null,
      input.durationSeconds === undefined ? null : input.durationSeconds,
      id,
      publisherId,
      // An absent field leaves the column alone; an explicit null clears it.
      input.isbn13 !== undefined,
      input.description !== undefined,
      input.durationSeconds !== undefined,
    ],
  );

  const updated = result.rows[0];
  if (!updated) {
    // Either not ours, or archived (read-only until restored).
    const archived = await pool.query(
      `SELECT 1 FROM books
        WHERE id = $1 AND ($2::uuid IS NULL OR publisher_id = $2) AND archived_at IS NOT NULL`,
      [id, publisherId],
    );
    if (archived.rowCount) {
      throw new AppError(
        409,
        'This title is archived and read-only. Restore it before editing.',
        'BOOK_ARCHIVED',
      );
    }
    throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  }

  res.json({ book: await respondBook(updated.id, publisherId) });
});

let publishHook: (() => Promise<void>) | null = null;

/** Test seam: runs between the publish checks and the update, to exercise races. */
export function setPublishHookForTests(hook: (() => Promise<void>) | null): void {
  publishHook = hook;
}

function archivedError(): AppError {
  return new AppError(
    409,
    'This title is archived. Restore it before publishing.',
    'BOOK_ARCHIVED',
  );
}

/**
 * Publishes a staged title to the live reader storefront (`is_available = true`).
 * Rejects unless the title has a ready current asset.
 */
publisherRouter.post('/books/:id/publish', async (req: Request, res: Response) => {
  const { id } = bookIdParamSchema.parse(req.params);

  const publisherId = bookWriteScope(req);

  const existingResult = await pool.query<{
    has_ready_asset: boolean;
    withdrawn: boolean;
    archived: boolean;
  }>(
    `SELECT EXISTS (SELECT 1 FROM book_assets ba
                     WHERE ba.id = b.current_asset_id AND ba.state = 'ready') AS has_ready_asset,
            b.withdrawn_at IS NOT NULL AS withdrawn,
            b.archived_at IS NOT NULL AS archived
       FROM books b
      WHERE b.id = $1
        AND ($2::uuid IS NULL OR b.publisher_id = $2)`,
    [id, publisherId],
  );

  const existing = existingResult.rows[0];
  if (!existing) {
    throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  }

  if (existing.withdrawn) {
    throw new AppError(403, 'This title has been withdrawn and cannot be published', 'FORBIDDEN');
  }

  if (existing.archived) throw archivedError();

  if (!existing.has_ready_asset) {
    throw new AppError(
      400,
      'Cannot publish a book without a ready asset. Upload and process an EPUB first.',
      'ASSET_REQUIRED',
    );
  }

  await publishHook?.();

  const result = await pool.query<PublisherBookRow>(
    `UPDATE books
        SET is_available = TRUE,
            published_at = COALESCE(published_at, CURRENT_DATE)
      WHERE id = $1
        AND withdrawn_at IS NULL
        AND archived_at IS NULL
        AND ($2::uuid IS NULL OR publisher_id = $2)
  RETURNING id`,
    [id, publisherId],
  );

  // The book exists (checked above), so no row means an archive or takedown landed after that check.
  if (result.rows.length === 0) {
    const now = await pool.query<{ archived: boolean }>(
      'SELECT archived_at IS NOT NULL AS archived FROM books WHERE id = $1',
      [id],
    );
    if (!now.rows[0]) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
    if (now.rows[0].archived) throw archivedError();
    throw new AppError(403, 'This title has been withdrawn and cannot be published', 'FORBIDDEN');
  }

  res.json({ book: await respondBook(id, publisherId) });
});

/**
 * Unpublishes a book from the storefront (`is_available = false`).
 */
publisherRouter.post('/books/:id/unpublish', async (req: Request, res: Response) => {
  const { id } = bookIdParamSchema.parse(req.params);
  const publisherId = bookWriteScope(req);

  const result = await pool.query<PublisherBookRow>(
    `UPDATE books
        SET is_available = FALSE
      WHERE id = $1
        AND ($2::uuid IS NULL OR publisher_id = $2)
  RETURNING id`,
    [id, publisherId],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  }

  res.json({ book: await respondBook(updated.id, publisherId) });
});

/**
 * Archives a book: off sale for good (it cannot be published until restored),
 * while everyone who owns it keeps reading. One statement, so the book leaves
 * the storefront at the same moment it is archived.
 */
publisherRouter.post('/books/:id/archive', async (req: Request, res: Response) => {
  const { id } = bookIdParamSchema.parse(req.params);
  const publisherId = bookWriteScope(req);

  const result = await pool.query(
    `UPDATE books
        SET archived_at = NOW(), is_available = FALSE
      WHERE id = $1
        AND withdrawn_at IS NULL
        AND archived_at IS NULL
        AND ($2::uuid IS NULL OR publisher_id = $2)
  RETURNING id`,
    [id, publisherId],
  );

  if (result.rows.length === 0) {
    const current = await pool.query<{ withdrawn: boolean; archived: boolean }>(
      `SELECT withdrawn_at IS NOT NULL AS withdrawn, archived_at IS NOT NULL AS archived
         FROM books WHERE id = $1 AND ($2::uuid IS NULL OR publisher_id = $2)`,
      [id, publisherId],
    );
    const book = current.rows[0];
    if (!book) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
    if (book.withdrawn) {
      throw new AppError(403, 'This title has been withdrawn and cannot be archived', 'FORBIDDEN');
    }
    throw new AppError(409, 'This title is already archived', 'BOOK_ARCHIVED');
  }

  res.json({ book: await respondBook(id, publisherId) });
});

/**
 * Restores an archived book. It stays off sale: publishing is a separate,
 * deliberate step. Restoring a book that is not archived changes nothing.
 */
publisherRouter.post('/books/:id/restore', async (req: Request, res: Response) => {
  const { id } = bookIdParamSchema.parse(req.params);
  const publisherId = bookWriteScope(req);

  const result = await pool.query(
    `UPDATE books
        SET archived_at = NULL
      WHERE id = $1
        AND ($2::uuid IS NULL OR publisher_id = $2)
  RETURNING id`,
    [id, publisherId],
  );
  if (result.rows.length === 0) {
    throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  }

  res.json({ book: await respondBook(id, publisherId) });
});

/** Permanently deletes a book that has never been sold, with its files. */
publisherRouter.delete('/books/:id', async (req: Request, res: Response) => {
  const { id } = bookIdParamSchema.parse(req.params);
  await deleteBook(id, bookWriteScope(req));
  res.status(204).end();
});
