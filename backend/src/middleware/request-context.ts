import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../lib/logger';

/**
 * Accept an upstream ID (load balancer, mobile client) only if it is short and
 * boring, so it cannot be used to inject content into logs.
 */
const INCOMING_ID = /^[A-Za-z0-9._-]{8,128}$/;

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Assigns `req.requestId`, echoes it as a response header, and logs completion. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);
  req.requestId = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info('request completed', {
      requestId: req.requestId,
      method: req.method,
      // Path only: query strings can carry search terms and other user input.
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 10) / 10,
      ...(req.auth && { userId: req.auth.userId }),
    });
  });

  next();
}
