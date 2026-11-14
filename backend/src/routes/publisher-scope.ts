import { z } from 'zod';
import type { Request } from 'express';
import { authContext } from '../middleware/auth';
import { AppError } from '../middleware/errors';

/**
 * The publisher a request acts for. Publisher accounts are always scoped to
 * their own house; admins must name one (or be linked to one).
 * Lives apart from publisher.ts so sub-routers can use it without a cycle.
 */
export function resolvePublisherScope(req: Request, explicitId?: string): string {
  const auth = authContext(req);
  if (auth.role === 'admin') {
    if (explicitId) return explicitId;
    if (auth.publisherId) return auth.publisherId;
    throw new AppError(
      400,
      'publisherId must be specified for admin operations',
      'PUBLISHER_ID_REQUIRED',
    );
  }

  if (!auth.publisherId) {
    throw new AppError(403, 'Account is not linked to a publishing house', 'PUBLISHER_NOT_LINKED');
  }

  return auth.publisherId;
}

export const publisherScopeQuerySchema = z.object({
  publisherId: z.string().uuid('Not a valid publisher id').optional(),
});

/**
 * The publisher_id to filter by, or null for "all publishers" (admins only).
 * Fails closed: a publisher account without a linked house is rejected rather
 * than falling through to the unfiltered query.
 */
export function tenantFilter(req: Request): string | null {
  const auth = authContext(req);
  if (auth.role === 'admin') {
    return null;
  }
  if (!auth.publisherId) {
    throw new AppError(403, 'Account is not linked to a publishing house', 'PUBLISHER_NOT_LINKED');
  }
  return auth.publisherId;
}

/**
 * The publisher_id a book write is checked against. Publishers: their own
 * house. Admins: the publisher they picked in the portal (query parameter), so a
 * stale picker cannot edit another house's book; none means any book.
 */
export function bookWriteScope(req: Request): string | null {
  const scope = tenantFilter(req);
  if (scope !== null) return scope;
  return publisherScopeQuerySchema.parse(req.query).publisherId ?? null;
}
