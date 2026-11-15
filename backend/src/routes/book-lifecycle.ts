import { isPgError, PG_FOREIGN_KEY_VIOLATION } from '../db/errors';
import { pool } from '../db/pool';
import { objectStorage } from '../drm/object-storage';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errors';
import { hasProcessingAssetSql, hasSalesSql } from './publisher-books';

const HAS_SALES = () =>
  new AppError(
    409,
    "This book has sales or checkout history, so it can't be deleted. Archive it instead.",
    'BOOK_HAS_SALES',
  );

interface AssetRef {
  id: string;
  version: number;
  object_key: string | null;
}

/**
 * Permanently deletes a book that has never been sold. The row lock plus the
 * RESTRICT foreign keys make a purchase that races the delete a clean 409.
 * Stored objects go after the commit, best effort.
 */
export async function deleteBook(bookId: string, scope: string | null): Promise<void> {
  const client = await pool.connect();
  const assets: AssetRef[] = [];
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      withdrawn: boolean;
      published: boolean;
      processing: boolean;
      has_sales: boolean;
    }>(
      `SELECT b.withdrawn_at IS NOT NULL AS withdrawn,
              b.is_available AS published,
              ${hasProcessingAssetSql('b')} AS processing,
              ${hasSalesSql('b')} AS has_sales
         FROM books b
        WHERE b.id = $1 AND ($2::uuid IS NULL OR b.publisher_id = $2)
          FOR UPDATE OF b`,
      [bookId, scope],
    );
    const book = rows[0];
    if (!book) throw new AppError(404, 'Book not found or access denied', 'NOT_FOUND');
    if (book.withdrawn) {
      throw new AppError(403, 'This title has been withdrawn and cannot be deleted', 'FORBIDDEN');
    }
    if (book.published) {
      throw new AppError(409, 'Unpublish this title before deleting it', 'BOOK_PUBLISHED');
    }
    if (book.processing) {
      throw new AppError(
        409,
        'A file for this title is still being processed. Try again in a moment.',
        'ASSET_PROCESSING',
      );
    }
    if (book.has_sales) throw HAS_SALES();

    const found = await client.query<AssetRef>(
      'SELECT id, version, object_key FROM book_assets WHERE book_id = $1',
      [bookId],
    );
    assets.push(...found.rows);
    try {
      await client.query('UPDATE books SET current_asset_id = NULL WHERE id = $1', [bookId]);
      await client.query('DELETE FROM book_assets WHERE book_id = $1', [bookId]);
      await client.query('DELETE FROM books WHERE id = $1', [bookId]);
    } catch (error) {
      // A sale slipped in after the checks: the foreign keys are the last line of defence.
      if (isPgError(error, PG_FOREIGN_KEY_VIOLATION)) throw HAS_SALES();
      throw error;
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await removeStoredObjects(bookId, assets);
}

/** Best effort and logged: the wrapped keys are already gone, so a missed ciphertext is unreadable. */
async function removeStoredObjects(bookId: string, assets: AssetRef[]): Promise<void> {
  const storage = objectStorage();
  const keys = new Set<string>();
  const collect = async (prefix: string) => {
    try {
      for (const object of await storage.list(prefix)) keys.add(object.key);
    } catch (err) {
      logger.warn('could not list objects of a deleted book', { prefix, err });
    }
  };
  for (const asset of assets) {
    if (asset.object_key) keys.add(asset.object_key);
    keys.add(`quarantine/${asset.id}`);
    // Ingestion attempts write below `assets/{id}/v{n}/`; sweep any a failed attempt left.
    await collect(`assets/${asset.id}/v${asset.version}/`);
  }
  await collect(`covers/${bookId}/`);
  for (const key of keys) {
    await storage
      .delete(key)
      .catch((err) => logger.warn('could not delete an object of a deleted book', { key, err }));
  }
}
