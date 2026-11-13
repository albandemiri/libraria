import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { isPgError, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from '../db/errors';
import { requireEntitlement } from '../commerce/entitlements';
import { pool } from '../db/pool';
import { authContext, requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { deriveBookKey } from '../utils/crypto';

export const libraryRouter = Router();

// All library and reader-state endpoints require an authenticated user.
libraryRouter.use(requireAuth);

const SORT_KEYS = ['recent', 'acquired', 'title'] as const;

const SORTS: Record<(typeof SORT_KEYS)[number], string> = {
  recent: 'ul.last_read_at DESC NULLS LAST, ul.acquired_at DESC',
  acquired: 'ul.acquired_at DESC',
  title: 'b.title ASC',
};

export const listQuerySchema = z.object({
  sort: z.enum(SORT_KEYS).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const bookIdParamSchema = z.object({
  bookId: z.string().uuid('Not a valid book id'),
});

export const bookmarkIdParamSchema = bookIdParamSchema.extend({
  bookmarkId: z.string().uuid('Not a valid bookmark id'),
});

export const highlightIdParamSchema = bookIdParamSchema.extend({
  highlightId: z.string().uuid('Not a valid highlight id'),
});

export const updateProgressSchema = z.object({
  progress: z
    .record(z.string(), z.unknown())
    .refine(
      (val) => JSON.stringify(val).length <= 16384,
      'Reading progress JSON payload exceeds 16KB limit',
    ),
  lastReadAt: z.coerce.date().optional(),
});

export const createBookmarkSchema = z.object({
  location: z.string().trim().min(1, 'Location is required').max(500),
  label: z.string().trim().min(1).max(200).optional(),
});

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;

export const createHighlightSchema = z.object({
  startLocation: z.string().trim().min(1, 'Start location is required').max(500),
  endLocation: z.string().trim().min(1, 'End location is required').max(500),
  highlightedText: z.string().trim().min(1, 'Highlighted text is required').max(10000),
  note: z.string().trim().max(5000).optional(),
  color: z.enum(HIGHLIGHT_COLORS).default('yellow'),
});

export const updateHighlightSchema = z.object({
  note: z.string().trim().max(5000).nullable().optional(),
  color: z.enum(HIGHLIGHT_COLORS).optional(),
});

interface LibraryRow {
  book_id: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  cover_image_url: string | null;
  media_type: 'ebook' | 'audiobook';
  duration_seconds: number | null;
  publisher_id: string;
  publisher_name: string;
  acquired_at: Date;
  last_read_at: Date | null;
  reading_progress: Record<string, unknown>;
  total_count?: string;
  bookmarks_count?: string;
  highlights_count?: string;
}

interface BookmarkRow {
  id: string;
  book_id: string;
  location: string;
  label: string | null;
  created_at: Date;
}

interface HighlightRow {
  id: string;
  book_id: string;
  start_location: string;
  end_location: string;
  highlighted_text: string;
  note: string | null;
  color: string;
  created_at: Date;
  updated_at: Date;
}

interface AssetRow {
  encrypted_file_url: string | null;
  encryption_iv: Buffer | null;
  encryption_auth_tag: Buffer | null;
  file_size_bytes: string | null;
  media_type: 'ebook' | 'audiobook';
}

function publicLibraryItem(row: LibraryRow) {
  return {
    book: {
      id: row.book_id,
      title: row.title,
      author: row.author,
      isbn13: row.isbn13,
      description: row.description,
      genre: row.genre,
      language: row.language,
      coverImageUrl: row.cover_image_url,
      mediaType: row.media_type,
      durationSeconds: row.duration_seconds,
      publisher: {
        id: row.publisher_id,
        name: row.publisher_name,
      },
    },
    acquiredAt: row.acquired_at,
    lastReadAt: row.last_read_at,
    readingProgress: row.reading_progress ?? {},
    ...(row.bookmarks_count !== undefined && {
      bookmarksCount: Number(row.bookmarks_count),
    }),
    ...(row.highlights_count !== undefined && {
      highlightsCount: Number(row.highlights_count),
    }),
  };
}

function publicBookmark(row: BookmarkRow) {
  return {
    id: row.id,
    bookId: row.book_id,
    location: row.location,
    label: row.label,
    createdAt: row.created_at,
  };
}

function publicHighlight(row: HighlightRow) {
  return {
    id: row.id,
    bookId: row.book_id,
    startLocation: row.start_location,
    endLocation: row.end_location,
    highlightedText: row.highlighted_text,
    note: row.note,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Digital Bookshelf (User Library)
// ---------------------------------------------------------------------------

/**
 * Lists books currently in the authenticated user's library with reading progress.
 */
libraryRouter.get('/', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { sort, page, limit } = listQuerySchema.parse(req.query);
  const offset = (page - 1) * limit;

  const result = await pool.query<LibraryRow>(
    `SELECT ul.book_id,
            ul.acquired_at,
            ul.last_read_at,
            ul.reading_progress,
            b.title,
            b.author,
            b.isbn13,
            b.description,
            b.genre,
            b.language,
            b.cover_image_url,
            b.media_type,
            b.duration_seconds,
            b.publisher_id,
            p.name AS publisher_name,
            COUNT(*) OVER() AS total_count
       FROM user_libraries ul
       JOIN entitlements e
         ON e.user_id = ul.user_id AND e.book_id = ul.book_id AND e.status = 'active'
       JOIN books b ON b.id = ul.book_id
       JOIN publishers p ON p.id = b.publisher_id
      WHERE ul.user_id = $1
      ORDER BY ${SORTS[sort]}
      LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  const total = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  res.json({
    books: result.rows.map(publicLibraryItem),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

/**
 * Fetches a single book in the user's library along with annotation counts.
 */
libraryRouter.get('/:bookId', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);

  const result = await pool.query<LibraryRow>(
    `SELECT ul.book_id,
            ul.acquired_at,
            ul.last_read_at,
            ul.reading_progress,
            b.title,
            b.author,
            b.isbn13,
            b.description,
            b.genre,
            b.language,
            b.cover_image_url,
            b.media_type,
            b.duration_seconds,
            b.publisher_id,
            p.name AS publisher_name,
            (SELECT COUNT(*)::text FROM bookmarks bm WHERE bm.user_id = ul.user_id AND bm.book_id = ul.book_id) AS bookmarks_count,
            (SELECT COUNT(*)::text FROM highlights hl WHERE hl.user_id = ul.user_id AND hl.book_id = ul.book_id) AS highlights_count
       FROM user_libraries ul
       JOIN entitlements e
         ON e.user_id = ul.user_id AND e.book_id = ul.book_id AND e.status = 'active'
       JOIN books b ON b.id = ul.book_id
       JOIN publishers p ON p.id = b.publisher_id
      WHERE ul.user_id = $1 AND ul.book_id = $2`,
    [userId, bookId],
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, 'Book not found in user library', 'NOT_FOUND');
  }

  res.json({ book: publicLibraryItem(row) });
});

/**
 * Updates or syncs reading progress for an owned book.
 */
libraryRouter.put('/:bookId/progress', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);
  const { progress, lastReadAt } = updateProgressSchema.parse(req.body);
  await requireEntitlement(userId, bookId);

  const timestamp = lastReadAt ?? new Date();

  const result = await pool.query<{
    reading_progress: Record<string, unknown>;
    last_read_at: Date;
  }>(
    `UPDATE user_libraries
        SET reading_progress = $1,
            last_read_at = $2
      WHERE user_id = $3 AND book_id = $4
  RETURNING reading_progress, last_read_at`,
    [JSON.stringify(progress), timestamp, userId, bookId],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new AppError(404, 'Book not found in user library', 'NOT_FOUND');
  }

  res.json({
    bookId,
    readingProgress: updated.reading_progress,
    lastReadAt: updated.last_read_at,
  });
});

/**
 * Securely retrieves asset decryption parameters for an owned title.
 */
libraryRouter.get('/:bookId/asset', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);

  await requireEntitlement(userId, bookId);

  const assetResult = await pool.query<AssetRow>(
    `SELECT encrypted_file_url,
            encryption_iv,
            encryption_auth_tag,
            file_size_bytes,
            media_type
       FROM books
      WHERE id = $1`,
    [bookId],
  );

  const asset = assetResult.rows[0];
  if (!asset?.encrypted_file_url || !asset.encryption_iv || !asset.encryption_auth_tag) {
    throw new AppError(409, 'Asset is not yet available for download', 'ASSET_UNAVAILABLE');
  }

  res.json({
    bookId,
    mediaType: asset.media_type,
    fileSizeBytes: asset.file_size_bytes ? Number(asset.file_size_bytes) : null,
    encryptedFileUrl: asset.encrypted_file_url,
    encryptionIv: asset.encryption_iv.toString('base64'),
    encryptionAuthTag: asset.encryption_auth_tag.toString('base64'),
  });
});

/**
 * Delivers the 256-bit AES-GCM decryption key for an owned title.
 */
libraryRouter.get('/:bookId/key', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);

  await requireEntitlement(userId, bookId);

  const keyBuffer = deriveBookKey(bookId, env.JWT_SECRET);

  res.json({
    bookId,
    key: keyBuffer.toString('base64'),
    algorithm: 'aes-256-gcm',
  });
});

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

/**
 * Lists all bookmarks for an owned book.
 */
libraryRouter.get('/:bookId/bookmarks', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);

  await requireEntitlement(userId, bookId);

  const result = await pool.query<BookmarkRow>(
    `SELECT id, book_id, location, label, created_at
       FROM bookmarks
      WHERE user_id = $1 AND book_id = $2
      ORDER BY created_at DESC`,
    [userId, bookId],
  );

  res.json({
    bookmarks: result.rows.map(publicBookmark),
  });
});

/**
 * Adds a bookmark to an owned book.
 */
libraryRouter.post('/:bookId/bookmarks', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);
  const { location, label } = createBookmarkSchema.parse(req.body);
  await requireEntitlement(userId, bookId);

  try {
    const result = await pool.query<BookmarkRow>(
      `INSERT INTO bookmarks (user_id, book_id, location, label)
       VALUES ($1, $2, $3, $4)
       RETURNING id, book_id, location, label, created_at`,
      [userId, bookId, location, label ?? null],
    );

    res.status(201).json({ bookmark: publicBookmark(result.rows[0]) });
  } catch (error) {
    if (isPgError(error, PG_UNIQUE_VIOLATION)) {
      throw new AppError(409, 'A bookmark already exists at this location', 'DUPLICATE_BOOKMARK');
    }
    if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
      throw new AppError(404, 'Book not found in user library', 'NOT_FOUND');
    }
    throw error;
  }
});

/**
 * Removes a bookmark.
 */
libraryRouter.delete('/:bookId/bookmarks/:bookmarkId', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId, bookmarkId } = bookmarkIdParamSchema.parse(req.params);

  const result = await pool.query(
    `DELETE FROM bookmarks
      WHERE id = $1 AND user_id = $2 AND book_id = $3`,
    [bookmarkId, userId, bookId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Bookmark not found', 'NOT_FOUND');
  }

  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

/**
 * Lists all highlights and notes for an owned book.
 */
libraryRouter.get('/:bookId/highlights', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);

  await requireEntitlement(userId, bookId);

  const result = await pool.query<HighlightRow>(
    `SELECT id, book_id, start_location, end_location, highlighted_text, note, color, created_at, updated_at
       FROM highlights
      WHERE user_id = $1 AND book_id = $2
      ORDER BY created_at DESC`,
    [userId, bookId],
  );

  res.json({
    highlights: result.rows.map(publicHighlight),
  });
});

/**
 * Adds a highlight with optional note and color.
 */
libraryRouter.post('/:bookId/highlights', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId } = bookIdParamSchema.parse(req.params);
  const { startLocation, endLocation, highlightedText, note, color } = createHighlightSchema.parse(
    req.body,
  );
  await requireEntitlement(userId, bookId);

  try {
    const result = await pool.query<HighlightRow>(
      `INSERT INTO highlights (user_id, book_id, start_location, end_location, highlighted_text, note, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, book_id, start_location, end_location, highlighted_text, note, color, created_at, updated_at`,
      [userId, bookId, startLocation, endLocation, highlightedText, note ?? null, color],
    );

    res.status(201).json({ highlight: publicHighlight(result.rows[0]) });
  } catch (error) {
    if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) {
      throw new AppError(404, 'Book not found in user library', 'NOT_FOUND');
    }
    throw error;
  }
});

/**
 * Updates a highlight's note or color.
 */
libraryRouter.patch('/:bookId/highlights/:highlightId', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId, highlightId } = highlightIdParamSchema.parse(req.params);
  const { note, color } = updateHighlightSchema.parse(req.body);
  await requireEntitlement(userId, bookId);

  if (note === undefined && color === undefined) {
    throw new AppError(
      400,
      'Must provide at least one field to update (note or color)',
      'NO_FIELDS_TO_UPDATE',
    );
  }

  const result = await pool.query<HighlightRow>(
    `UPDATE highlights
          SET note = COALESCE($1, note),
              color = COALESCE($2, color)
        WHERE id = $3 AND user_id = $4 AND book_id = $5
    RETURNING id, book_id, start_location, end_location, highlighted_text, note, color, created_at, updated_at`,
    [note === undefined ? null : note, color ?? null, highlightId, userId, bookId],
  );

  const updated = result.rows[0];
  if (!updated) {
    throw new AppError(404, 'Highlight not found', 'NOT_FOUND');
  }

  res.json({ highlight: publicHighlight(updated) });
});

/**
 * Deletes a highlight.
 */
libraryRouter.delete('/:bookId/highlights/:highlightId', async (req: Request, res: Response) => {
  const { userId } = authContext(req);
  const { bookId, highlightId } = highlightIdParamSchema.parse(req.params);

  const result = await pool.query(
    `DELETE FROM highlights
        WHERE id = $1 AND user_id = $2 AND book_id = $3`,
    [highlightId, userId, bookId],
  );

  if (result.rowCount === 0) {
    throw new AppError(404, 'Highlight not found', 'NOT_FOUND');
  }

  res.status(204).send();
});
