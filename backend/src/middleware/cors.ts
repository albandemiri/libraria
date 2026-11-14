import type { RequestHandler } from 'express';

/**
 * Exact-match origin allowlist with credentials, for the publisher portal.
 * An origin is only ever echoed back when it is in the list; nothing is
 * reflected otherwise and `*` is never used (it is invalid with credentials).
 */
export function cors(allowed: string[]): RequestHandler {
  const allowlist = new Set(allowed);

  return (req, res, next) => {
    const origin = req.get('origin');
    const permitted = origin !== undefined && allowlist.has(origin);

    // The response differs by Origin, so shared caches must key on it.
    res.append('Vary', 'Origin');

    if (permitted) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    if (req.method === 'OPTIONS') {
      if (permitted) {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type,X-Libraria-Portal,X-Request-Id',
        );
      }
      res.sendStatus(204);
      return;
    }

    next();
  };
}
