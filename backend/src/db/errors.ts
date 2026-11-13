/** PostgreSQL SQLSTATE codes the routes translate into API errors. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';

export function isPgError(error: unknown, sqlState: string): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === sqlState
  );
}
