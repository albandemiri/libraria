import { Pool } from 'pg';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export const pool = new Pool({
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,
  database: env.POSTGRES_DB,
});

// An idle client erroring out is a background event with no request to reject,
// so without this listener it would take the process down.
pool.on('error', (error) => {
  logger.error('unexpected error on idle database client', { err: error });
});

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
