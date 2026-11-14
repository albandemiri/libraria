import type { NextFunction, Request, Response } from 'express';
import { PORTAL_COOKIE, PORTAL_HEADER, readCookie } from '../auth/portal-session';
import { type AuthContext, type UserRole, verifyAccessToken } from '../auth/tokens';
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

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Rejects the request unless it carries a valid access token: a Bearer token
 * (mobile) first, otherwise the portal session cookie. A Bearer header that is
 * present but invalid is rejected outright, never retried as a cookie.
 *
 * Cookies are sent by browsers automatically, so a cookie-authenticated write
 * must also prove it came from our portal by sending `X-Libraria-Portal: 1`
 * (a custom header cannot be set cross-origin without a CORS preflight).
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const bearer = bearerToken(req);
  const cookie = bearer ? null : readCookie(req.get('cookie'), PORTAL_COOKIE);
  const token = bearer ?? cookie;
  if (!token) {
    next(new AppError(401, 'Missing bearer token', 'UNAUTHENTICATED'));
    return;
  }

  const auth = verifyAccessToken(token);
  if (!auth) {
    next(new AppError(401, 'Invalid or expired token', 'UNAUTHENTICATED'));
    return;
  }

  if (!bearer && !SAFE_METHODS.has(req.method) && req.get(PORTAL_HEADER) !== '1') {
    next(new AppError(403, 'Missing portal request header', 'CSRF_CHECK_FAILED'));
    return;
  }

  req.auth = auth;
  req.authSource = bearer ? 'bearer' : 'cookie';
  next();
}

/** Must be mounted after `requireAuth`. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError(401, 'Missing bearer token', 'UNAUTHENTICATED'));
      return;
    }

    if (!roles.includes(req.auth.role)) {
      next(new AppError(403, 'Insufficient permissions', 'FORBIDDEN'));
      return;
    }

    next();
  };
}

/** Narrows `req.auth` for handlers already behind `requireAuth`. */
export function authContext(req: Request): AuthContext {
  if (!req.auth) {
    throw new AppError(401, 'Missing bearer token', 'UNAUTHENTICATED');
  }
  return req.auth;
}
