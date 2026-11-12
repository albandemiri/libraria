import { NextFunction, Request, Response } from 'express';
import { AuthContext, UserRole, verifyAccessToken } from '../auth/tokens';
import { AppError } from './errors';

export type { AuthContext } from '../auth/tokens';

function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(' ');
  if (!token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token.trim() || null;
}

/** Rejects the request unless it carries a valid access token. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = bearerToken(req);
  if (!token) {
    next(new AppError(401, 'Missing bearer token', 'unauthenticated'));
    return;
  }

  const auth = verifyAccessToken(token);
  if (!auth) {
    next(new AppError(401, 'Invalid or expired token', 'unauthenticated'));
    return;
  }

  req.auth = auth;
  next();
}

/** Must be mounted after `requireAuth`. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError(401, 'Missing bearer token', 'unauthenticated'));
      return;
    }

    if (!roles.includes(req.auth.role)) {
      next(new AppError(403, 'Insufficient permissions', 'forbidden'));
      return;
    }

    next();
  };
}

/** Narrows `req.auth` for handlers already behind `requireAuth`. */
export function authContext(req: Request): AuthContext {
  if (!req.auth) {
    throw new AppError(401, 'Missing bearer token', 'unauthenticated');
  }
  return req.auth;
}
