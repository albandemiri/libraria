import type { AuthContext } from '../auth/tokens';

declare global {
  namespace Express {
    interface Request {
      /** Populated by `requireAuth`; absent on unauthenticated routes. */
      auth?: AuthContext;
    }
  }
}
