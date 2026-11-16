import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { sniffImageType } from '../covers/sniff';
import { pool } from '../db/pool';
import { objectStorage } from '../drm/object-storage';
import { optionalAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { buildBookFilter, ownedSql, type StorefrontFilters } from '../storefront/books-query';
import { STORE_BOOK_COLUMNS, type StoreBookRow, toStoreBook } from '../storefront/store-book';

export const booksRouter = Router();

/** Whitelisted ORDER BY clauses, so sort input never reaches SQL as text. */
const SORT_KEYS = ['new', 'top', 'title', 'price_asc', 'price_desc'] as const;

const SORTS: Record<(typeof SORT_KEYS)[number], string> = {
  new: 'b.published_at DESC NULLS LAST, b.created_at DESC',
  top: 'sales_count DESC, b.published_at DESC NULLS LAST',
  title: 'b.title ASC',
  price_asc: 'b.price_cents ASC, b.title ASC',
  price_desc: 'b.price_cents DESC, b.title ASC',
};

const filterFields = {
  genre: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  publisherId: z
    .union([z.string().uuid(), z.array(z.string().uuid()).max(20)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  language: z
    .string()
    .regex(/^[a-z]{2,3}$/, 'Must be 2-3 lowercase letters')
    .optional(),
  minPrice: z.coerce.number().int().min(0).max(2147483647).optional(),
  maxPrice: z.coerce.number().int().min(0).max(2147483647).optional(),
  publishedSince: z.coerce.date().optional(),
  hideOwned: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
};

const priceRangeValid = (q: { minPrice?: number; maxPrice?: number }) =>
  q.minPrice === undefined || q.maxPrice === undefined || q.maxPrice >= q.minPrice;
const priceRangeIssue = { message: 'maxPrice must not be below minPrice', path: ['maxPrice'] };

const listQuerySchema = z
  .object({
    ...filterFields,
    sort: z.enum(SORT_KEYS).default('new'),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(priceRangeValid, priceRangeIssue);

const facetsQuerySchema = z.object(filterFields).refine(priceRangeValid, priceRangeIssue);

const idParamSchema = z.object({ id: z.string().uuid('Not a valid book id') });

// Must be declared before `/:id`, or "genres" is parsed as a book id.
booksRouter.get('/genres', async (_req: Request, res: Response) => {
  const result = await pool.query<{ genre: string; book_count: string }>(
    `SELECT genre, COUNT(*) AS book_count
       FROM books
      WHERE is_available AND media_type = 'ebook'
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

// Each dimension is counted with every other filter applied but not its own,
// so the reader can still see (and switch to) the alternatives. Declared before `/:id`.
booksRouter.get('/facets', optionalAuth, async (req: Request, res: Response) => {
  const { publisherId, ...rest } = facetsQuerySchema.parse(req.query);
  const viewerId = req.auth?.userId ?? null;
  const filters: StorefrontFilters = { ...rest, publisherIds: publisherId };

  const count = async <T>(
    without: keyof StorefrontFilters | null,
    select: string | null,
    groupBy: string,
  ): Promise<T[]> => {
    const filter = buildBookFilter(
      without ? { ...filters, [without]: undefined } : filters,
      viewerId,
      1,
    );
    const result = await pool.query(
      `SELECT ${select ? `${select}, ` : ''}COUNT(*) AS book_count
         FROM books b
         JOIN publishers p ON p.id = b.publisher_id
        WHERE ${filter.where}
        ${groupBy}`,
      filter.params,
    );
    return result.rows;
  };

  const [totalRows, genres, publishers, languages] = await Promise.all([
    count<{ book_count: string }>(null, null, ''),
    count<{ genre: string; book_count: string }>(
      'genre',
      'b.genre',
      'GROUP BY b.genre ORDER BY b.genre',
    ),
    count<{ id: string; name: string; book_count: string }>(
      'publisherIds',
      'p.id, p.name',
      'GROUP BY p.id, p.name ORDER BY p.name',
    ),
    count<{ language: string; book_count: string }>(
      'language',
      'b.language',
      'GROUP BY b.language ORDER BY b.language',
    ),
  ]);

  res.json({
    total: Number(totalRows[0]?.book_count ?? 0),
    genres: genres.map((r) => ({ genre: r.genre, bookCount: Number(r.book_count) })),
    publishers: publishers.map((r) => ({
      id: r.id,
      name: r.name,
      bookCount: Number(r.book_count),
    })),
    languages: languages.map((r) => ({ language: r.language, bookCount: Number(r.book_count) })),
  });
});

booksRouter.get('/', optionalAuth, async (req: Request, res: Response) => {
  const { sort, page, limit, publisherId, ...rest } = listQuerySchema.parse(req.query);
  const offset = (page - 1) * limit;
  const viewerId = req.auth?.userId ?? null;

  // With a viewer, $1 is the viewer (for the `owned` column); filters follow, then paging.
  const lead: unknown[] = viewerId ? [viewerId] : [];
  const filter = buildBookFilter({ ...rest, publisherIds: publisherId }, viewerId, lead.length + 1);
  const limitParam = `$${lead.length + filter.params.length + 1}`;
  const offsetParam = `$${lead.length + filter.params.length + 2}`;

  const result = await pool.query<StoreBookRow & { sales_count: number; total_count: string }>(
    `SELECT ${STORE_BOOK_COLUMNS},
            ${viewerId ? ownedSql('$1') : 'FALSE'} AS owned,
            COALESCE(s.sales_count, 0) AS sales_count,
            COUNT(*) OVER() AS total_count
       FROM books b
       JOIN publishers p ON p.id = b.publisher_id
       LEFT JOIN (SELECT book_id, sales_count FROM book_sales) s ON s.book_id = b.id
      WHERE ${filter.where}
      ORDER BY ${SORTS[sort]}
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
    [...lead, ...filter.params, limit, offset],
  );

  // COUNT(*) OVER() rides on the page rows, so a page past the end has none:
  // count separately then, so the total stays correct.
  let total: number;
  if (result.rows.length > 0) {
    total = Number(result.rows[0].total_count);
  } else {
    const countFilter = buildBookFilter({ ...rest, publisherIds: publisherId }, viewerId, 1);
    const counted = await pool.query<{ total: string }>(
      `SELECT COUNT(*) AS total
         FROM books b
         JOIN publishers p ON p.id = b.publisher_id
        WHERE ${countFilter.where}`,
      countFilter.params,
    );
    total = Number(counted.rows[0].total);
  }

  res.json({
    books: result.rows.map((row) => toStoreBook(row, viewerId)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

type Availability = 'on_sale' | 'not_for_sale' | 'archived' | 'taken_down';

interface Viewer {
  owned: boolean;
  acquiredAt: Date | null;
  progress: { percent: number | null; chapterTitle: string | null } | null;
  refund: { purchasedAt: Date | null; refundedAt: Date } | null;
  pendingTransactionId: string | null;
}

/** Everything the signed-in reader's book page needs to pick its call to action. */
async function loadViewer(userId: string, bookId: string): Promise<Viewer> {
  const [entitlement, library, refund, pending] = await Promise.all([
    pool.query<{ granted_at: Date }>(
      `SELECT granted_at FROM entitlements
        WHERE user_id = $1 AND book_id = $2 AND status = 'active'
        ORDER BY granted_at DESC LIMIT 1`,
      [userId, bookId],
    ),
    pool.query<{ reading_progress: { percent?: unknown; chapterTitle?: unknown } | null }>(
      `SELECT reading_progress FROM user_libraries WHERE user_id = $1 AND book_id = $2`,
      [userId, bookId],
    ),
    pool.query<{ paid_at: Date | null; refunded_at: Date }>(
      `SELECT t.paid_at, ti.refunded_at
         FROM transaction_items ti
         JOIN transactions t ON t.id = ti.transaction_id
        WHERE t.user_id = $1 AND ti.book_id = $2 AND ti.refunded_at IS NOT NULL
        ORDER BY ti.refunded_at DESC LIMIT 1`,
      [userId, bookId],
    ),
    pool.query<{ id: string }>(
      `SELECT t.id
         FROM transactions t
         JOIN transaction_items ti ON ti.transaction_id = t.id
        WHERE t.user_id = $1 AND ti.book_id = $2 AND t.status = 'pending'
        ORDER BY t.created_at DESC LIMIT 1`,
      [userId, bookId],
    ),
  ]);

  const owned = entitlement.rows.length > 0;
  const raw = library.rows[0]?.reading_progress;
  const percent = typeof raw?.percent === 'number' ? raw.percent : null;
  const chapterTitle = typeof raw?.chapterTitle === 'string' ? raw.chapterTitle : null;
  const refunded = refund.rows[0];

  return {
    owned,
    acquiredAt: entitlement.rows[0]?.granted_at ?? null,
    progress: percent === null && chapterTitle === null ? null : { percent, chapterTitle },
    refund:
      !owned && refunded
        ? { purchasedAt: refunded.paid_at, refundedAt: refunded.refunded_at }
        : null,
    pendingTransactionId: pending.rows[0]?.id ?? null,
  };
}

booksRouter.get('/:id', optionalAuth, async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const viewerId = req.auth?.userId ?? null;

  const result = await pool.query<
    StoreBookRow & {
      is_available: boolean;
      archived_at: Date | null;
      withdrawn_at: Date | null;
      text_characters: string | null;
    }
  >(
    `SELECT ${STORE_BOOK_COLUMNS},
            ${viewerId ? ownedSql('$2') : 'FALSE'} AS owned,
            b.is_available, b.archived_at, b.withdrawn_at,
            ba.extracted_metadata->>'textCharacters' AS text_characters
       FROM books b
       JOIN publishers p ON p.id = b.publisher_id
       LEFT JOIN book_assets ba ON ba.id = b.current_asset_id
      WHERE b.id = $1 AND b.media_type = 'ebook'`,
    viewerId ? [id, viewerId] : [id],
  );

  const row = result.rows[0];
  // Archived and taken-down books stay visible to the people who own them;
  // never-published books are visible to no one.
  let availability: Availability | null = null;
  if (row) {
    if (row.withdrawn_at) availability = row.owned ? 'taken_down' : null;
    else if (row.archived_at) availability = row.owned ? 'archived' : null;
    else if (row.is_available) availability = row.for_sale ? 'on_sale' : 'not_for_sale';
  }
  if (!row || !availability) {
    throw new AppError(404, 'Book not found', 'NOT_FOUND');
  }

  const characters = row.text_characters === null ? Number.NaN : Number(row.text_characters);
  const pageCount = Number.isFinite(characters) ? Math.max(1, Math.round(characters / 1800)) : null;

  const book = { ...toStoreBook(row, viewerId), pageCount, availability };
  res.json(viewerId ? { book, viewer: await loadViewer(viewerId, id) } : { book });
});

/**
 * The book's cover. Public and cacheable (private to the owner when the book is taken down): the uploaded cover when there is one
 * (`?size=thumb` for its thumbnail), otherwise the cover the ingestion worker
 * extracted from the current asset, which has no thumbnail. The `v` in
 * `coverImageUrl` changes with every upload or removal, busting the cache.
 */
booksRouter.get('/:id/cover', optionalAuth, async (req: Request, res: Response) => {
  const { id } = idParamSchema.parse(req.params);
  const { rows } = await pool.query<{
    current_asset_id: string | null;
    cover_object_key: string | null;
    cover_thumb_key: string | null;
    withdrawn: boolean;
  }>(
    `SELECT current_asset_id, cover_object_key, cover_thumb_key, withdrawn_at IS NOT NULL AS withdrawn
       FROM books WHERE id = $1`,
    [id],
  );
  const book = rows[0];
  if (!book) throw new AppError(404, 'Cover not found', 'NOT_FOUND');

  // A taken-down book's cover is only for the people who own it.
  if (book.withdrawn) {
    const viewerId = req.auth?.userId;
    const owner = viewerId
      ? await pool.query(
          `SELECT 1 FROM entitlements WHERE user_id = $1 AND book_id = $2 AND status = 'active'`,
          [viewerId, id],
        )
      : null;
    if (!owner || owner.rows.length === 0) throw new AppError(404, 'Cover not found', 'NOT_FOUND');
  }

  const uploaded =
    req.query.size === 'thumb'
      ? (book.cover_thumb_key ?? book.cover_object_key)
      : book.cover_object_key;
  const key = uploaded ?? (book.current_asset_id ? `covers/${id}/${book.current_asset_id}` : null);
  if (!key) throw new AppError(404, 'Cover not found', 'NOT_FOUND');

  const storage = objectStorage();
  const data = (await storage.head(key)) ? await storage.get(key).catch(() => null) : null;
  const type = data ? sniffImageType(data) : null;
  if (!data || !type) throw new AppError(404, 'Cover not found', 'NOT_FOUND');

  res
    .status(200)
    .set({
      'Content-Type': type,
      'Content-Length': String(data.length),
      'Cache-Control': book.withdrawn ? 'private, max-age=300' : 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(data);
});
