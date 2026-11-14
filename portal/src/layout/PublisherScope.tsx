import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { fetchPublishers } from '../api/auth';
import type { PublisherSummary } from '../api/types';
import { useAuth } from '../auth/AuthProvider';

const STORAGE_KEY = 'libraria.portal.publisherId';

type Scope = {
  /** Set only for admins who picked a publisher; publishers are scoped by the server. */
  publisherId: string | undefined;
  setPublisherId(id: string): void;
  isAdmin: boolean;
  publishers: PublisherSummary[];
};

const ScopeContext = createContext<Scope | null>(null);

function readStored(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function PublisherScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [picked, setPicked] = useState<string | undefined>(readStored);

  const { data: publishers = [] } = useQuery({
    queryKey: ['admin', 'publishers'],
    queryFn: fetchPublishers,
    enabled: isAdmin,
  });

  const setPublisherId = useCallback((id: string) => {
    setPicked(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage unavailable; the pick lasts for this session only.
    }
  }, []);

  // A stale remembered id (publisher no longer exists) must not leak into requests.
  const valid =
    isAdmin && picked !== undefined && publishers.some((p) => p.id === picked) ? picked : undefined;

  const value = useMemo<Scope>(
    () => ({ publisherId: valid, setPublisherId, isAdmin, publishers }),
    [valid, setPublisherId, isAdmin, publishers],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function usePublisherScope(): Scope {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error('usePublisherScope must be used inside <PublisherScopeProvider>');
  return ctx;
}
