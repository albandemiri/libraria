import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { authContext, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errors';

export const publisherRouter = Router();

// Publisher endpoints require an authenticated user with 'publisher' or 'admin' role.
publisherRouter.use(requireAuth, requireRole('publisher', 'admin'));

export const listPublisherBooksQuerySchema = z.object({
  status: z.enum(['all', 'published', 'draft']).default('all'),
  search: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const bookIdParamSchema = z.object({
  id: z.string().uuid('Not a valid book id'),
});

const isbn13Regex = /^[0-9]{13}$/;

export const createBookSchema = z
  .object({
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
    language: z.string().trim().length(2, 'Language must be a 2-letter ISO 639-1 code').default('en'),
    priceCents: z.coerce.number().int().min(0, 'Price cannot be negative'),
    currency: z.string().trim().length(3).default('USD'),
    coverImageUrl: z.string().trim().url('Not a valid URL').nullable().optional(),
    mediaType: z.enum(['ebook', 'audiobook']).default('ebook'),
    durationSeconds: z.coerce.number().int().positive().nullable().optional(),
    publisherId: z.string().uuid().optional(),
  })
  .refine(
    (data) => data.mediaType === 'audiobook' || data.durationSeconds == null,
    {
      message: 'durationSeconds is only allowed for audiobooks',
      path: ['durationSeconds'],
    },
  );

export const updateBookSchema = z
  .object({
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
    language: z.string().trim().length(2).optional(),
    priceCents: z.coerce.number().int().min(0).optional(),
    currency: z.string().trim().length(3).optional(),
    coverImageUrl: z.string().trim().url().nullable().optional(),
    mediaType: z.enum(['ebook', 'audiobook']).optional(),
    durationSeconds: z.coerce.number().int().positive().nullable().optional(),
  })
  .refine(
    (data) => data.mediaType === 'audiobook' || data.durationSeconds == null,
    {
      message: 'durationSeconds is only allowed for audiobooks',
      path: ['durationSeconds'],
    },
  );

export const setAssetSchema = z.object({
  encryptedFileUrl: z.string().trim().min(1, 'Asset URL is required'),
  encryptionIv: z.string().trim().base64('encryptionIv must be base64-encoded bytes'),
  encryptionAuthTag: z.string().trim().base64('encryptionAuthTag must be base64-encoded bytes'),
  fileSizeBytes: z.coerce.number().int().positive('fileSizeBytes must be positive'),
});

interface PublisherBookRow {
  id: string;
  publisher_id: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  price_cents: number;
  currency: string;
  cover_image_url: string | null;
  published_at: Date | null;
  is_available: boolean;
  media_type: 'ebook' | 'audiobook';
  duration_seconds: number | null;
  encrypted_file_url: string | null;
  file_size_bytes: string | null;
  has_encryption_keys: boolean;
  sales_count: number;
  total_revenue_cents: number;
  created_at: Date;
  updated_at: Date;
  total_count?: string;
}

function resolvePublisherScope(req: Request, explicitId?: string): string {
  const auth = authContext(req);
  if (auth.role === 'admin') {
    if (explicitId) return explicitId;
    if (auth.publisherId) return auth.publisherId;
    throw new AppError(400, 'publisherId must be specified for admin operations', 'publisher_id_required');
  }

  if (!auth.publisherId) {
    throw new AppError(403, 'Account is not linked to a publishing house', 'forbidden');
  }

  return auth.publisherId;
}

function formatPublisherBook(row: PublisherBookRow) {
  return {
    id: row.id,
    publisherId: row.publisher_id,
    title: row.title,
    author: row.author,
    isbn13: row.isbn13,
    description: row.description,
    genre: row.genre,
    language: row.language,
    price: {
      amountCents: row.price_cents,
      currency: row.currency,
    },
    coverImageUrl: row.cover_image_url,
    publishedAt: row.published_at,
    isAvailable: row.is_available,
    mediaType: row.media_type,
    durationSeconds: row.duration_seconds,
    hasAsset: Boolean(row.encrypted_file_url && row.has_encryption_keys),
    fileSizeBytes: row.file_size_bytes ? Number(row.file_size_bytes) : null,
    metrics: {
      salesCount: Number(row.sales_count ?? 0),
      totalRevenueCents: Number(row.total_revenue_cents ?? 0),
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Lists books belonging to the publisher portal account (drafts & published).
 */
publisherRouter.get('/books', async (req: Request, res: Response) => {
  const auth = authContext(req);
  const publisherId = auth.role === 'publisher' ? auth.publisherId : req.query.publisherId ? String(req.query.publisherId) : null;
  const { status, search, page, limit } = listPublisherBooksQuerySchema.parse(req.query);
  const offset = (page - 1) * limit;

  const result = await pool.query<PublisherBookRow>(
    `SELECT b.id,
            b.publisher_id,
            b.title,
            b.author,
            b.isbn13,
            b.description,
            b.genre,
            b.language,
            b.price_cents,
            b.currency,
            b.cover_image_url,
            b.published_at,
            b.is_available,
            b.media_type,
            b.duration_seconds,
            b.encrypted_file_url,
            b.file_size_bytes,
            (b.encryption_iv IS NOT NULL AND b.encryption_auth_tag IS NOT NULL) AS has_encryption_keys,
            b.created_at,
            b.updated_at,
            COALESCE(s.sales_count, 0) AS sales_count,
            COALESCE(s.total_revenue, 0) AS total_revenue_cents,
            COUNT(*) OVER() AS total_count
       FROM books b
       LEFT JOIN (
         SELECT book_id,
                COUNT(*)::int AS sales_count,
                SUM(amount_cents)::int AS total_revenue
           FROM transactions
          WHERE status = 'completed'
          GROUP BY book_id
       ) s ON s.book_id = b.id
      WHERE ($1::uuid IS NULL OR b.publisher_id = $1)
        AND (
          $2::text = 'all'
          OR ($2 = 'published' AND b.is_available)
          OR ($2 = 'draft' AND NOT b.is_available)
        )
        AND ($3::text IS NULL OR b.title ILIKE $3 OR b.author ILIKE $3)
      ORDER BY b.updated_at DESC
      LIMIT $4 OFFSET $5`,
    [
      publisherId,
      status,
      search ? `%${search.replace(/([\\%_])/g, '\\$1')}%` : null,
      limit,
      offset,
    ],
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
  const publisherId = resolvePublisherScope(req, req.query.publisherId as string | undefined);

  const statsResult = await pool.query<{
    total_titles: string;
    published_titles: string;
    draft_titles: string;
    total_copies_sold: string;
    total_revenue_cents: string;
  }>(
    `SELECT COUNT(b.id)::int AS total_titles,
            COUNT(b.id) FILTER (WHERE b.is_available)::int AS published_titles,
            COUNT(b.id) FILTER (WHERE NOT b.is_available)::int AS draft_titles,
            COALESCE(SUM(s.sales_count), 0)::int AS total_copies_sold,
            COALESCE(SUM(s.total_revenue), 0)::int AS total_revenue_cents
       FROM books b
       LEFT JOIN (
         SELECT book_id,
                COUNT(*)::int AS sales_count,
                SUM(amount_cents)::int AS total_revenue
           FROM transactions
          WHERE status = 'completed'
          GROUP BY book_id
       ) s ON s.book_id = b.id
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
    },
  });
});

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
       cover_image_url,
       media_type,
       duration_seconds,
       is_available
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, FALSE)
     RETURNING id, publisher_id, title, author, isbn13, description, genre, language,
               price_cents, currency, cover_image_url, published_at, is_available,
               media_type, duration_seconds, encrypted_file_url, file_size_bytes,
               FALSE as has_encryption_keys,
               0 as sales_count, 0 as total_revenue_cents, created_at, updated_at`,
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
      input.coverImageUrl ?? null,
      input.mediaType,
      input.durationSeconds ?? null,
    ],
  );

  res.status(201).json({ book: formatPublisherBook(result.rows[0]) });
});

/**
 * Retrieves a single book's publisher details.
 */
publisherRouter.get('/books/:id', async (req: Request, res: Response) => {
  const auth = authContext(req);
  const { id } = bookIdParamSchema.parse(req.params);

  const result = await pool.query<PublisherBookRow>(
    `SELECT b.id,
            b.publisher_id,
            b.title,
            b.author,
            b.isbn13,
            b.description,
            b.genre,
            b.language,
            b.price_cents,
            b.currency,
            b.cover_image_url,
            b.published_at,
            b.is_available,
            b.media_type,
            b.duration_seconds,
            b.encrypted_file_url,
            b.file_size_bytes,
            (b.encryption_iv IS NOT NULL AND b.encryption_auth_tag IS NOT NULL) AS has_encryption_keys,
            b.created_at,
            b.updated_at,
            COALESCE(s.sales_count, 0) AS sales_count,
            COALESCE(s.total_revenue, 0) AS total_revenue_cents
       FROM books b
       LEFT JOIN (
         SELECT book_id,
                COUNT(*)::int AS sales_count,
                SUM(amount_cents)::int AS total_revenue
           FROM transactions
          WHERE status = 'completed'
          GROUP BY book_id
       ) s ON s.book_id = b.id
      WHERE b.id = $1
        AND ($2::uuid IS NULL OR b.publisher_id = $2)`,
    [id, auth.role === 'admin' ? null : auth.publisherId],
  );

  const book = result.rows[0];
  if (!book) {
    throw new AppError(404, 'Book not found or access denied', 'not_found');
  }

  res.json({ book: formatPublisherBook(book) });
});

/**
 * Updates a book draft or existing title's metadata.
 */
publisherRouter.patch('/books/:id', async (req: Request, res: Response) => {
  const auth = authContext(req);
  const { id } = bookIdParamSchema.parse(req.params);
  const input = updateBookSchema.parse(req.body);

  const publisherId = auth.role === 'admin' ? null : auth.publisherId;

  const result = await pool.query<PublisherBookRow>(
    `UPDATE books
        SET title = COALESCE($1, title),
            author = COALESCE($2, author),
            isbn13 = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE isbn13 END,
            description = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE description END,
            genre = COALESCE($5, genre),
            language = COALESCE($6, language),
            price_cents = COALESCE($7, price_cents),
            currency = COALESCE($8, currency),
            cover_image_url = CASE WHEN $9::text IS NOT NULL THEN $9 ELSE cover_image_url END,
            media_type = COALESCE($10, media_type),
            duration_seconds = CASE WHEN $11::int IS NOT NULL THEN $11 ELSE duration_seconds END
      WHERE id = $12
        AND ($13::uuid IS NULL OR publisher_id = $13)
  RETURNING id, publisher_id, title, author, isbn13, description, genre, language,
            price_cents, currency, cover_image_url, published_at, is_available,
            media_type, duration_seconds, encrypted_file_url, file_size_bytes,
            (encryption_iv IS NOT NULL AND encryption_auth_tag IS NOT NULL) AS has_encryption_keys,
            0 as sales_count, 0 as total_revenue_cents, created_at, updated_at`,
    [
      input.title ?? null,
      input.author ?? null,
      input.isbn13 === undefined ? null : input.isbn13,
      input.description === undefined ? null : input.description,
      input.genre ?? null,
      input.language ?? null,
      input.priceCents ?? null,
      input.currency ?? null,
      input.coverImageUrl === undefined ? null : input.coverImageUrl,
      input.mediaType ?? null,
      input.durationSeconds === undefined ? null : input.durationSeconds,
      id,
      publisherId,
    ],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new AppError(404, 'Book not found or access denied', 'not_found');
  }

  res.json({ book: formatPublisherBook(updated) });
});

/**
 * Attaches or updates the encrypted DRM asset payload for a book.
 */
publisherRouter.post('/books/:id/asset', async (req: Request, res: Response) => {
  const auth = authContext(req);
  const { id } = bookIdParamSchema.parse(req.params);
  const { encryptedFileUrl, encryptionIv, encryptionAuthTag, fileSizeBytes } = setAssetSchema.parse(
    req.body,
  );

  const ivBuffer = Buffer.from(encryptionIv, 'base64');
  const authTagBuffer = Buffer.from(encryptionAuthTag, 'base64');

  const result = await pool.query<PublisherBookRow>(
    `UPDATE books
        SET encrypted_file_url = $1,
            encryption_iv = $2,
            encryption_auth_tag = $3,
            file_size_bytes = $4
      WHERE id = $5
        AND ($6::uuid IS NULL OR publisher_id = $6)
  RETURNING id, publisher_id, title, author, isbn13, description, genre, language,
            price_cents, currency, cover_image_url, published_at, is_available,
            media_type, duration_seconds, encrypted_file_url, file_size_bytes,
            TRUE as has_encryption_keys,
            0 as sales_count, 0 as total_revenue_cents, created_at, updated_at`,
    [
      encryptedFileUrl,
      ivBuffer,
      authTagBuffer,
      fileSizeBytes,
      id,
      auth.role === 'admin' ? null : auth.publisherId,
    ],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new AppError(404, 'Book not found or access denied', 'not_found');
  }

  res.json({ book: formatPublisherBook(updated) });
});

/**
 * Publishes a staged title to the live reader storefront (`is_available = true`).
 * Rejects if the title lacks an encrypted asset.
 */
publisherRouter.post('/books/:id/publish', async (req: Request, res: Response) => {
  const auth = authContext(req);
  const { id } = bookIdParamSchema.parse(req.params);

  // Check asset completeness first
  const existingResult = await pool.query<{
    encrypted_file_url: string | null;
    encryption_iv: Buffer | null;
    encryption_auth_tag: Buffer | null;
  }>(
    `SELECT encrypted_file_url, encryption_iv, encryption_auth_tag
       FROM books
      WHERE id = $1
        AND ($2::uuid IS NULL OR publisher_id = $2)`,
    [id, auth.role === 'admin' ? null : auth.publisherId],
  );

  const existing = existingResult.rows[0];
  if (!existing) {
    throw new AppError(404, 'Book not found or access denied', 'not_found');
  }

  if (!existing.encrypted_file_url || !existing.encryption_iv || !existing.encryption_auth_tag) {
    throw new AppError(
      400,
      'Cannot publish a book without an uploaded encrypted asset (URL, IV, and Auth Tag required)',
      'asset_required',
    );
  }

  const result = await pool.query<PublisherBookRow>(
    `UPDATE books
        SET is_available = TRUE,
            published_at = COALESCE(published_at, CURRENT_DATE)
      WHERE id = $1
  RETURNING id, publisher_id, title, author, isbn13, description, genre, language,
            price_cents, currency, cover_image_url, published_at, is_available,
            media_type, duration_seconds, encrypted_file_url, file_size_bytes,
            TRUE as has_encryption_keys,
            0 as sales_count, 0 as total_revenue_cents, created_at, updated_at`,
    [id],
  );

  res.json({ book: formatPublisherBook(result.rows[0]) });
});

/**
 * Unpublishes a book from the storefront (`is_available = false`).
 */
publisherRouter.post('/books/:id/unpublish', async (req: Request, res: Response) => {
  const auth = authContext(req);
  const { id } = bookIdParamSchema.parse(req.params);

  const result = await pool.query<PublisherBookRow>(
    `UPDATE books
        SET is_available = FALSE
      WHERE id = $1
        AND ($2::uuid IS NULL OR publisher_id = $2)
  RETURNING id, publisher_id, title, author, isbn13, description, genre, language,
            price_cents, currency, cover_image_url, published_at, is_available,
            media_type, duration_seconds, encrypted_file_url, file_size_bytes,
            (encryption_iv IS NOT NULL AND encryption_auth_tag IS NOT NULL) AS has_encryption_keys,
            0 as sales_count, 0 as total_revenue_cents, created_at, updated_at`,
    [id, auth.role === 'admin' ? null : auth.publisherId],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new AppError(404, 'Book not found or access denied', 'not_found');
  }

  res.json({ book: formatPublisherBook(updated) });
});

