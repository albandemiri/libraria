import { pool } from '../db/pool';
import { AppError } from '../middleware/errors';

/**
 * The single access check for a user's book (spec 13.1 #1, #4). Ownership is
 * an active entitlement: a refunded or charged-back purchase keeps its
 * history and the reader's annotations, but no longer grants access.
 */
export async function hasActiveEntitlement(userId: string, bookId: string): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM entitlements
        WHERE user_id = $1 AND book_id = $2 AND status = 'active'
     ) AS exists`,
    [userId, bookId],
  );
  return rows[0]?.exists === true;
}

/** Throws the same 404 whether the book does not exist or is not owned. */
export async function requireEntitlement(userId: string, bookId: string): Promise<void> {
  if (!(await hasActiveEntitlement(userId, bookId))) {
    throw new AppError(404, 'Book not found in user library', 'NOT_FOUND');
  }
}
