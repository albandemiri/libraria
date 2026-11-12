import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env';

/** An error whose message and status are safe to send to the client. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'error',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Request validation failed',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }

  // Anything unrecognised is a bug: log it in full, but do not leak internals
  // (stack traces, SQL, constraint names) to the caller in production.
  console.error('Unhandled error', error);
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: isProduction
        ? 'Internal server error'
        : error instanceof Error
          ? error.message
          : String(error),
    },
  });
}
