import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Every machine-readable error code the API can return. Clients branch on
 * these, so treat them as part of the public contract: add freely, but rename
 * or remove only with an API version bump (spec 6.1, 6.2).
 */
export const errorCodes = [
  // Generic
  'VALIDATION_FAILED',
  'MALFORMED_JSON',
  'PAYLOAD_TOO_LARGE',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'ROUTE_NOT_FOUND',
  'INTERNAL_ERROR',
  // Identity
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'PORTAL_ACCESS_DENIED',
  'CSRF_CHECK_FAILED',
  // Commerce
  'ALREADY_OWNED',
  'PAYMENTS_UNAVAILABLE',
  'UNSUPPORTED_CURRENCY',
  'IDEMPOTENCY_KEY_REUSED',
  'PAYMENT_PROVIDER_ERROR',
  'INVALID_SIGNATURE',
  'UNKNOWN_PAYMENT_PROVIDER',
  'BOOK_NOT_FOR_SALE',
  'COMMISSION_RATE_EXISTS',
  // Library / reader
  'ASSET_UNAVAILABLE',
  'DUPLICATE_BOOKMARK',
  'NO_FIELDS_TO_UPDATE',
  // Publisher
  'PUBLISHER_ID_REQUIRED',
  'PUBLISHER_NOT_LINKED',
  'ASSET_REQUIRED',
  // Reports
  'EXPORT_TOO_LARGE',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

/** An error whose message and status are safe to send to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: ErrorCode,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
    details?: Array<{ path: string; message: string }>;
  };
}

function send(
  req: Request,
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: ErrorBody['error']['details'],
): void {
  const body: ErrorBody = {
    error: { code, message, requestId: req.requestId, ...(details && { details }) },
  };
  res.status(status).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  send(req, res, 404, 'ROUTE_NOT_FOUND', 'Route not found');
}

/** Errors raised by express.json() before any route runs. */
function bodyParserError(error: unknown): { status: number; type?: string } | null {
  if (typeof error !== 'object' || error === null) return null;
  const { status, type, expose } = error as { status?: unknown; type?: unknown; expose?: unknown };
  if (typeof status !== 'number' || expose !== true || status < 400 || status >= 500) return null;
  return { status, type: typeof type === 'string' ? type : undefined };
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    send(
      req,
      res,
      400,
      'VALIDATION_FAILED',
      'Request validation failed',
      error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
    return;
  }

  if (error instanceof AppError) {
    send(req, res, error.status, error.code, error.message);
    return;
  }

  const parserError = bodyParserError(error);
  if (parserError) {
    if (parserError.type === 'entity.parse.failed') {
      send(req, res, 400, 'MALFORMED_JSON', 'Request body is not valid JSON');
    } else if (parserError.type === 'entity.too.large') {
      send(req, res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    } else {
      send(req, res, parserError.status, 'BAD_REQUEST', 'Bad request');
    }
    return;
  }

  // Anything unrecognised is a bug: log it in full, but do not leak internals
  // (stack traces, SQL, constraint names) to the caller in production.
  logger.error('unhandled error', { requestId: req.requestId, err: error });
  send(
    req,
    res,
    500,
    'INTERNAL_ERROR',
    isProduction ? 'Internal server error' : error instanceof Error ? error.message : String(error),
  );
}
