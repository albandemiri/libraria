import { env } from '../config/env';

/** Allowlist: only these roles may sign in to the publisher portal. */
export function isPortalRole(role: string): boolean {
  return role === 'publisher' || role === 'admin';
}

export const PORTAL_COOKIE = 'libraria_portal';
/** Every cookie-authenticated write must send this header set to `1`. */
export const PORTAL_HEADER = 'x-libraria-portal';

const SECONDS_PER_DAY = 86_400;

/** Parses a `Cookie` request header. Returns null when the cookie is absent. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function attributes(secure: boolean): string[] {
  // Path=/api keeps the cookie off the static /assets and /health routes.
  const parts = ['HttpOnly', 'SameSite=Lax', 'Path=/api'];
  if (secure) {
    parts.push('Secure');
  }
  return parts;
}

/**
 * The full `Set-Cookie` value for a portal session. Without "remember me" it
 * is a browser-session cookie (the token itself still expires after
 * PORTAL_SESSION_HOURS).
 */
export function sessionCookie(
  token: string,
  rememberMe: boolean,
  secure: boolean = env.NODE_ENV === 'production',
): string {
  const parts = [`${PORTAL_COOKIE}=${token}`, ...attributes(secure)];
  if (rememberMe) {
    parts.push(`Max-Age=${env.PORTAL_REMEMBER_DAYS * SECONDS_PER_DAY}`);
  }
  return parts.join('; ');
}

export function clearedCookie(secure: boolean = env.NODE_ENV === 'production'): string {
  return [`${PORTAL_COOKIE}=`, ...attributes(secure), 'Max-Age=0'].join('; ');
}

/** JWT lifetime matching the cookie. */
export function portalTokenLifetime(rememberMe: boolean): string {
  return rememberMe ? `${env.PORTAL_REMEMBER_DAYS}d` : `${env.PORTAL_SESSION_HOURS}h`;
}
