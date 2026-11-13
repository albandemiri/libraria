import type { AuthContext } from '../auth/tokens';

declare global {
  namespace Express {
    interface Request {
      /** Set by `requestContext` before any route runs. */
      requestId: string;
      /** Populated by `requireAuth`; absent on unauthenticated routes. */
      auth?: AuthContext;
    }
  }
}
