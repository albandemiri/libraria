import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  acceptInvite as acceptInviteRequest,
  fetchMe,
  portalLogin,
  portalLogout,
} from '../api/auth';
import { UNAUTHORIZED_EVENT } from '../api/client';
import type { PortalUser } from '../api/types';

type AuthState = {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: PortalUser | null;
  /** True when a signed-in account (e.g. a reader) was refused by the portal. */
  accessDenied: boolean;
  /** True when a signed-in session ended because the server returned 401. */
  expired: boolean;
  login(email: string, password: string, rememberMe: boolean): Promise<void>;
  logout(): Promise<void>;
  /** Accepts a publisher invite; the API's cookie signs the new account in. */
  acceptInvite(token: string, password: string, displayName: string): Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

type Session = {
  status: AuthState['status'];
  user: PortalUser | null;
  accessDenied: boolean;
  expired: boolean;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session>({
    status: 'loading',
    user: null,
    accessDenied: false,
    expired: false,
  });

  const statusRef = useRef<AuthState['status']>('loading');
  statusRef.current = session.status;

  useEffect(() => {
    let cancelled = false;
    fetchMe()
      .then((user) => {
        if (cancelled) return;
        setSession(
          user.role === 'reader'
            ? { status: 'anonymous', user: null, accessDenied: true, expired: false }
            : { status: 'authenticated', user, accessDenied: false, expired: false },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSession({ status: 'anonymous', user: null, accessDenied: false, expired: false });
        }
      });
    const onUnauthorized = () => {
      // Only a session that was signed in can "expire"; a 401 on the first
      // /auth/me or on a failed login is just "not signed in".
      const wasSignedIn = statusRef.current === 'authenticated';
      setSession((prev) =>
        prev.status === 'authenticated'
          ? { status: 'anonymous', user: null, accessDenied: false, expired: true }
          : { ...prev, status: 'anonymous', user: null },
      );
      // An anonymous visitor's 401 (first /auth/me, a failed login) has nothing to clear, and
      // clearing would cancel queries other pages have in flight.
      if (wasSignedIn) queryClient.clear();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      cancelled = true;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string, rememberMe: boolean) => {
    const user = await portalLogin(email, password, rememberMe);
    setSession({ status: 'authenticated', user, accessDenied: false, expired: false });
  }, []);

  const acceptInvite = useCallback(
    async (token: string, password: string, displayName: string) => {
      const user = await acceptInviteRequest(token, password, displayName);
      // Anything cached belongs to whoever was here before.
      queryClient.clear();
      setSession({ status: 'authenticated', user, accessDenied: false, expired: false });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await portalLogout();
    } finally {
      queryClient.clear();
      setSession({ status: 'anonymous', user: null, accessDenied: false, expired: false });
    }
  }, [queryClient]);

  const value = useMemo<AuthState>(
    () => ({ ...session, login, logout, acceptInvite }),
    [session, login, logout, acceptInvite],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
