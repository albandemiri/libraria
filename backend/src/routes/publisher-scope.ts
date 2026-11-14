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
