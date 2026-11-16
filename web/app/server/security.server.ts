import { env } from './env.server';

function forbidden(): Response {
  return new Response('Forbidden', { status: 403 });
}

function originOf(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF guard for every action. A present `Origin` must equal `PUBLIC_ORIGIN` exactly (scheme,
 * host and port). Without one, the `Referer` must come from that origin. Throws a 403 Response.
 */
export function assertSameOrigin(request: Request): void {
  const expected = originOf(env.PUBLIC_ORIGIN);
  const origin = request.headers.get('Origin');
  const actual = origin !== null ? origin : originOf(request.headers.get('Referer') ?? '');
  // `Origin: null` (opaque origins) is not a valid origin and never matches.
  if (expected === null || actual === null || actual !== expected) throw forbidden();
}
