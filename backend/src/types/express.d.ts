import type { AuthContext } from '../auth/tokens';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requestContext` before any route runs. */
      requestId: string;
      /** Populated by `requireAuth`; absent on unauthenticated routes. */
      auth?: AuthContext;
      /** How `requireAuth` authenticated the request; absent when it did not. */
      authSource?: 'bearer' | 'cookie';
    }
  }
}
