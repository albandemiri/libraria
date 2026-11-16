import { createCookieSessionStorage, type Session } from 'react-router';
import type { SessionUser } from '../lib/types';
import { env } from './env.server';

export type { SessionUser };

export type SessionData = {
  token?: string;
  user?: SessionUser;
  /** A checkout in flight per book, so a retry reuses the same transaction and idempotency key. */
  checkouts?: Record<string, { transactionId: string; idempotencyKey: string }>;
};

export type AppSession = Session<SessionData>;

const storage = createCookieSessionStorage<SessionData>({
  cookie: {
    name: 'libraria_session',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
    secrets: [env.SESSION_SECRET],
  },
});

export function getSession(request: Request): Promise<AppSession> {
  return storage.getSession(request.headers.get('Cookie'));
}

export function commitSession(session: AppSession): Promise<string> {
  return storage.commitSession(session);
}

export function destroySession(session: AppSession): Promise<string> {
  return storage.destroySession(session);
}
