import { ApiError } from '../../api/client';

const KNOWN = new Set([
  'EMAIL_TAKEN',
  'NOT_FOUND',
  'COMMISSION_RATE_EXISTS',
  'INVITE_ACCEPTED',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'BAD_REQUEST',
]);

/** The translation key for an admin API failure. Branches on the code, never the English message. */
export const adminErrorKey = (error: unknown): string =>
  error instanceof ApiError && KNOWN.has(error.code)
    ? `admin.errors.${error.code}`
    : 'admin.errors.generic';
