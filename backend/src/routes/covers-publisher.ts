import { randomUUID } from 'node:crypto';
import { type Request, type RequestHandler, type Response, Router } from 'express';
import { z } from 'zod';
import { COVER_MAX_BYTES, CoverCancelled, CoverError, processCover } from '../covers/process-cover';
import { pool } from '../db/pool';
import { objectStorage } from '../drm/object-storage';
import { logger } from '../lib/logger';
import { requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../middleware/errors';
import { rateLimit } from '../middleware/rate-limit';
import { cutOffUnreadBody, rawBodyWithLimit } from '../middleware/raw-body';
import { formatPublisherBook, loadPublisherBook, type PublisherBookRow } from './publisher-books';
import { publisherScopeQuerySchema, resolvePublisherScope } from './publisher-scope';

const bookParamSchema = z.object({ bookId: z.string().uuid('Not a valid book id') });

const COVER_STATUS = {
  COVER_TOO_LARGE: 413,
  COVER_UNSUPPORTED_TYPE: 415,
  COVER_TOO_SMALL: 422,
  COVER_BAD_SHAPE: 422,
  COVER_BUSY: 503,
  COVER_INVALID: 422,
} as const;

/** The publisher this request acts for; an admin must name one (`?publisherId=`). */
function coverScope(req: Request): string {
  return resolvePublisherScope(req, publisherScopeQuerySchema.parse(req.query).publisherId);
}

/** 404 for an unknown or foreign book, 403 for a withdrawn one, before any body byte is read. */
const guardCover: RequestHandler = async (req, _res, next) => {
  const { bookId } = bookParamSchema.parse(req.params);
  const { rows } = await pool.query<{ withdrawn: boolean; archived: boolean }>(
    `SELECT withdrawn_at IS NOT NULL AS withdrawn, archived_at IS NOT NULL AS archived
       FROM books WHERE id = $1 AND publisher_id = $2`,
    [bookId, coverScope(req)],
  );
  if (!rows[0]) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  if (rows[0].withdrawn) {
    throw new AppError(403, 'This title has been withdrawn and cannot be changed', 'FORBIDDEN');
  }
  if (rows[0].archived) throw archivedWriteError();
  next();
};

function archivedWriteError(): AppError {
  return new AppError(
    409,
    'This title is archived and read-only. Restore it before changing it.',
    'BOOK_ARCHIVED',
  );
}

interface LockedBook {
  cover_object_key: string | null;
  cover_thumb_key: string | null;
  current_asset_id: string | null;
  withdrawn: boolean;
  archived: boolean;
}

/**
 * Locks the book row, reads its current cover keys, and commits the new ones; the old objects are deleted only after the commit, so a
 * concurrent writer can never lose an object that the winning row points at.
 * The keys are read under the lock, so each upload deletes exactly what the
 * previous winner stored.
 */
export async function replaceCover(
  bookId: string,
  publisherId: string,
  keys: { objectKey: string | null; thumbKey: string | null },
): Promise<PublisherBookRow> {
  // The storage lookup stays out of the transaction (and the row lock): look at the
  // asset the book points at now, and look again only if it moved before we locked.
  const storage = objectStorage();
  const hasEpubCover = async (assetId: string | null) =>
    assetId !== null && (await storage.head(`covers/${bookId}/${assetId}`)) !== null;
  const assetBefore = (
    await pool.query<{ current_asset_id: string | null }>(
      'SELECT current_asset_id FROM books WHERE id = $1',
      [bookId],
    )
  ).rows[0]?.current_asset_id;
  let fallsBackToEpub = keys.objectKey === null && (await hasEpubCover(assetBefore ?? null));

  const client = await pool.connect();
  let old: LockedBook;
  let updated: PublisherBookRow | undefined;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<LockedBook>(
      `SELECT cover_object_key, cover_thumb_key, current_asset_id,
              withdrawn_at IS NOT NULL AS withdrawn, archived_at IS NOT NULL AS archived
         FROM books WHERE id = $1 AND publisher_id = $2 FOR UPDATE`,
      [bookId, publisherId],
    );
    old = rows[0];
    if (!old) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
    if (old.withdrawn) {
      throw new AppError(403, 'This title has been withdrawn and cannot be changed', 'FORBIDDEN');
    }
    // Checked again under the lock: an archive may have landed after the pre-body guard.
    if (old.archived) throw archivedWriteError();
    // With no uploaded cover the public URL falls back to the EPUB cover, if there is one.
    if (keys.objectKey === null && old.current_asset_id !== (assetBefore ?? null)) {
      fallsBackToEpub = await hasEpubCover(old.current_asset_id);
    }
    await client.query(
      `UPDATE books
          SET cover_object_key = $2,
              cover_thumb_key = $3,
              cover_version = cover_version + 1,
              cover_image_url = CASE WHEN $2::text IS NOT NULL OR $4::boolean
                                     THEN '/api/v1/books/' || id || '/cover?v=' || (cover_version + 1)
                                     ELSE NULL END
        WHERE id = $1`,
      [bookId, keys.objectKey, keys.thumbKey, fallsBackToEpub],
    );
    // Read inside the transaction, so each response carries the version this write made.
    updated = await loadPublisherBook(bookId, publisherId, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  for (const key of [old.cover_object_key, old.cover_thumb_key]) {
    if (!key) continue;
    await objectStorage()
      .delete(key)
      .catch((err) => logger.warn('could not delete a replaced cover object', { key, err }));
  }
  if (!updated) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
  return updated;
}

const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'];

const receiveCover: RequestHandler = async (req: Request, res: Response) => {
  const { bookId } = bookParamSchema.parse(req.params);
  if (!Buffer.isBuffer(req.body)) {
    throw new AppError(
      415,
      'Send the image as the raw request body with Content-Type image/jpeg, image/png or image/webp.',
      'COVER_UNSUPPORTED_TYPE',
    );
  }

  let processed: Awaited<ReturnType<typeof processCover>>;
  try {
    processed = await processCover(req.body, { cancelled: () => req.socket.destroyed });
  } catch (error) {
    if (error instanceof CoverCancelled) return; // the client is gone: nobody to answer
    if (error instanceof CoverError) {
      if (error.code === 'COVER_BUSY') res.set('Retry-After', '5');
      throw new AppError(COVER_STATUS[error.code], error.message, error.code);
    }
    throw error;
  }

  const id = randomUUID();
  const objectKey = `covers/${bookId}/u-${id}.jpg`;
  const thumbKey = `covers/${bookId}/u-${id}-thumb.jpg`;
  const storage = objectStorage();
  let book: PublisherBookRow;
  try {
    await storage.put(objectKey, processed.main);
    await storage.put(thumbKey, processed.thumb);
    book = await replaceCover(bookId, coverScope(req), { objectKey, thumbKey });
  } catch (error) {
    // Nothing points at the new objects: do not leave them behind.
    for (const key of [objectKey, thumbKey]) {
      await storage.delete(key).catch(() => undefined);
    }
    throw error;
  }
  res.json({ book: formatPublisherBook(book) });
};

const publisherCoverLimit = rateLimit({
  name: 'cover-upload',
  limit: 60,
  windowMs: 60 * 60 * 1000,
  key: (req) => coverScope(req),
});

/** Registered by app.ts BEFORE express.json(), so the body is only read by the limited raw reader. */
export const uploadCoverHandlers: RequestHandler[] = [
  cutOffUnreadBody,
  requireAuth,
  requireRole('publisher', 'admin'),
  publisherCoverLimit,
  guardCover,
  rawBodyWithLimit(() => COVER_MAX_BYTES, COVER_TYPES, 'COVER_TOO_LARGE'),
  receiveCover,
];

/** DELETE, mounted under the publisher router (which already requires auth and a role). */
export const coverRouter = Router({ mergeParams: true });

coverRouter.delete('/', publisherCoverLimit, guardCover, async (req: Request, res: Response) => {
  const { bookId } = bookParamSchema.parse(req.params);
  const book = await replaceCover(bookId, coverScope(req), { objectKey: null, thumbKey: null });
  res.json({ book: formatPublisherBook(book) });
});
