import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { rateInForceSql } from '../commerce/rates';
import { pool } from '../db/pool';
import { AppError } from '../middleware/errors';

export const booksRouter = Router();

/**
 * Catalogue responses are assembled from an explicit column list. The DRM
 * columns (encrypted_file_url, encryption_iv, encryption_auth_tag) are never
 * part of it — asset access goes through the key-delivery endpoint instead.
 */
const CATALOGUE_COLUMNS = `
  b.id,
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
  b.media_type,
  b.duration_seconds,
  b.publisher_id,
  p.name AS publisher_name,
  ${rateInForceSql('b.publisher_id')} IS NOT NULL AS for_sale
`;

/** Whitelisted ORDER BY clauses, so sort input never reaches SQL as text. */
const SORT_KEYS = ['new', 'top', 'title', 'price_asc', 'price_desc'] as const;

const SORTS: Record<(typeof SORT_KEYS)[number], string> = {
  new: 'b.published_at DESC NULLS LAST, b.created_at DESC',
  top: 'sales_count DESC, b.published_at DESC NULLS LAST',
  title: 'b.title ASC',
  price_asc: 'b.price_cents ASC, b.title ASC',
  price_desc: 'b.price_cents DESC, b.title ASC',
};

const listQuerySchema = z.object({
  genre: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sort: z.enum(SORT_KEYS).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({ id: z.string().uuid('Not a valid book id') });

interface CatalogueRow {
  id: string;
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
  media_type: 'ebook' | 'audiobook';
  duration_seconds: number | null;
  publisher_id: string;
  publisher_name: string;
  for_sale: boolean;
  sales_count?: number;
  total_count?: string;
}

function publicBook(row: CatalogueRow) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    isbn13: row.isbn13,
    description: row.description,
    genre: row.genre,
    language: row.language,
    price: { amountCents: row.price_cents, currency: row.currency },
    coverImageUrl: row.cover_image_url,
    publishedAt: row.published_at,
    mediaType: row.media_type,
    durationSeconds: row.duration_seconds,
    publisher: { id: row.publisher_id, name: row.publisher_name },
    // False while the publisher has no commission rate in force: checkout
    // would refuse it with BOOK_NOT_FOR_SALE, so clients hide "Buy".
    forSale: row.for_sale,
  };
}

/** Escapes LIKE metacharacters so a search for "50%" is not a wildcard. */
function likePattern(term: string): string {
  return `%${term.replace(/([\\%_])/g, '\\$1')}%`;
}

// Must be declared before `/:id`, or "genres" is parsed as a book id.
booksRouter.get('/genres', async (_req: Request, res: Response) => {
  const result = await pool.query<{ genre: string; book_count: string }>(
    `SELECT genre, COUNT(*) AS book_count
       FROM books
      WHERE is_available
      GROUP BY genre
      ORDER BY genre ASC`,
  );

  res.json({
    genres: result.rows.map((row) => ({
      genre: row.genre,
      bookCount: Number(row.book_count),
    })),
  });
});

booksRouter.get('/', async (req: Request, res: Response) => {
  const { genre, search, sort, page, limit } = listQuerySchema.parse(req.query);
  const offset = (page - 1) * limit;

  const result = await pool.query<CatalogueRow>(
    `SELECT ${CATALOGUE_COLUMNS},
            COALESCE(s.sales_count, 0) AS sales_count,
            COUNT(*) OVER() AS total_count
       FROM books b
       JOIN publishers p ON p.id = b.publisher_id
       LEFT JOIN (SELECT book_id, sales_count FROM book_sales) s ON s.book_id = b.id
      WHERE b.is_available
        AND ($1::text IS NULL OR b.genre = $1)
        AND ($2::text IS NULL OR b.title ILIKE $2 OR b.author ILIKE $2)
      ORDER BY ${SORTS[sort]}
      LIMIT $3 OFFSET $4`,
    [genre ?? null, search ? likePattern(search) : null, limit, offset],
  );

  // COUNT(*) OVER() is absent when no rows matched, not zero.
  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  res.json({
    books: result.rows.map(publicBook),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

booksRouter.get('/:id', async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);

  const result = await pool.query<CatalogueRow>(
    `SELECT ${CATALOGUE_COLUMNS}
       FROM books b
       JOIN publishers p ON p.id = b.publisher_id
      WHERE b.id = $1
        AND b.is_available`,
    [id],
  );

  const book = result.rows[0];
  if (!book) {
    throw new AppError(404, 'Book not found', 'NOT_FOUND');
  }

  res.json({ book: publicBook(book) });
});
