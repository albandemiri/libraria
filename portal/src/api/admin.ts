import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DateRange, Granularity } from '../lib/periods';
import { api } from './client';
import type { Book, CommissionRate, Metrics, SummaryResponse } from './types';

/** Admin-only API calls for the Platform pages. Every route refuses anyone but an admin. */

export type AdminPublisher = {
  id: string;
  name: string;
  /** Two uppercase letters; ZZ means "other". Null for rows made before countries existed. */
  country: string | null;
  contactEmail: string;
  currentRateBps: number | null;
  bookCount: number;
  createdAt: string;
};

export type PublisherInput = { name: string; contactEmail: string; country: string };

export type TeamMember = {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
};

export type OpenInvite = {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
  expiresAt: string;
};

export type PublisherDetail = {
  publisher: AdminPublisher;
  team: TeamMember[];
  invites: OpenInvite[];
};

export type PlatformRow = {
  publisherId: string;
  publisherName: string;
  currentRateBps: number | null;
} & Metrics;

export type RateInput = { rateBps: number; effectiveFrom?: string; contractReference?: string };

/** Every key under this prefix is refreshed together after an admin change. */
const ADMIN = ['admin'] as const;

/** The publisher list. Shares the `['admin', 'publishers']` prefix with the sidebar picker. */
export const useAdminPublishers = (q = '') =>
  useQuery({
    queryKey: [...ADMIN, 'publishers', 'list', q],
    queryFn: () =>
      api<{ publishers: AdminPublisher[] }>('/admin/publishers', {
        query: { q: q || undefined },
      }).then((r) => r.publishers),
    placeholderData: keepPreviousData,
  });

export const useAdminPublisher = (id: string | undefined) =>
  useQuery({
    queryKey: [...ADMIN, 'publisher', id],
    queryFn: () => api<PublisherDetail>(`/admin/publishers/${id}`),
    enabled: id !== undefined,
  });

export function useCreatePublisher() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PublisherInput) =>
      api<{ publisher: AdminPublisher }>('/admin/publishers', {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.publisher),
    // The sidebar picker lists publishers too, so the whole prefix goes stale.
    onSuccess: () => client.invalidateQueries({ queryKey: [...ADMIN] }),
  });
}

export function useUpdatePublisher(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<PublisherInput>) =>
      api<{ publisher: AdminPublisher }>(`/admin/publishers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }).then((r) => r.publisher),
    onSuccess: () => client.invalidateQueries({ queryKey: [...ADMIN] }),
  });
}

/**
 * Create (or re-issue) and cancel invites. `create` resolves to the link, which the caller
 * shows once and drops: the mutation keeps nothing (`gcTime: 0`) and the link is never cached.
 */
export function useInviteActions(publisherId: string) {
  const client = useQueryClient();
  const refresh = () =>
    client.invalidateQueries({ queryKey: [...ADMIN, 'publisher', publisherId] });
  const create = useMutation({
    gcTime: 0,
    mutationFn: (input: { email: string; displayName?: string }) =>
      api<{ invite: OpenInvite; link: string }>(`/admin/publishers/${publisherId}/invites`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api<void>(`/admin/invites/${inviteId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  return { create, revoke };
}

/** Suspend or reactivate a login of this publisher's team. */
export function useUserStatus(publisherId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; status: 'active' | 'suspended' }) =>
      api<{ user: { id: string; status: string } }>(`/admin/users/${input.userId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: input.status }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...ADMIN, 'publisher', publisherId] }),
  });
}

export const usePublisherRates = (id: string) =>
  useQuery({
    queryKey: [...ADMIN, 'rates', id],
    queryFn: () =>
      api<{ publisherId: string; rates: CommissionRate[] }>(
        `/admin/publishers/${id}/commission-rates`,
      ).then((r) => r.rates),
  });

export function useAddRate(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RateInput) =>
      api<{ rate: CommissionRate }>(`/admin/publishers/${id}/commission-rates`, {
        method: 'POST',
        body: JSON.stringify(input),
      }).then((r) => r.rate),
    // The rate also shows on the publisher list and in the by-publisher table.
    onSuccess: () => client.invalidateQueries({ queryKey: [...ADMIN] }),
  });
}

export type AdminBook = Book & { publisherName: string };

/** One publisher's books, for its Books tab. */
export const usePublisherBooks = (publisherId: string, limit = 50) =>
  useQuery({
    queryKey: [...ADMIN, 'books', publisherId, limit],
    queryFn: () =>
      api<{
        books: AdminBook[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>('/admin/books', {
        query: { publisherId, sort: 'updated', order: 'desc', limit: String(limit) },
      }),
  });

export const usePlatformSummary = (range: DateRange, granularity: Granularity) =>
  useQuery({
    queryKey: [...ADMIN, 'reports', 'summary', range.from, range.to, granularity],
    queryFn: () =>
      api<SummaryResponse>('/admin/reports/summary', { query: { ...range, granularity } }),
  });

export const usePlatformByPublisher = (range: DateRange) =>
  useQuery({
    queryKey: [...ADMIN, 'reports', 'by-publisher', range.from, range.to],
    queryFn: () => api<{ rows: PlatformRow[] }>('/admin/reports/by-publisher', { query: range }),
  });

// ---------------------------------------------------------------------------
// Books across publishers, and reader support
// ---------------------------------------------------------------------------

export type AdminBooksParams = {
  q: string;
  status: string;
  publisherId: string | undefined;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  limit: number;
};

export const useAdminBooks = (params: AdminBooksParams, enabled = true) =>
  useQuery({
    queryKey: [...ADMIN, 'books', 'list', params],
    enabled,
    queryFn: () =>
      api<{
        books: AdminBook[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>('/admin/books', {
        query: {
          q: params.q || undefined,
          status: params.status,
          publisherId: params.publisherId,
          sort: params.sort,
          order: params.order,
          page: String(params.page),
          limit: String(params.limit),
        },
      }),
    placeholderData: keepPreviousData,
  });

/** Withdraw (with a reason) or reinstate a book. Both refresh every admin book list. */
export function useTakedown() {
  const client = useQueryClient();
  // The publisher's own catalog shows the same books, so it goes stale too.
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [...ADMIN, 'books'] }),
      client.invalidateQueries({ queryKey: ['books'] }),
    ]);
  const withdraw = useMutation({
    mutationFn: (input: { bookId: string; reason: string }) =>
      api<unknown>(`/admin/books/${input.bookId}/withdraw`, {
        method: 'POST',
        body: JSON.stringify({ reason: input.reason }),
      }),
    onSuccess: refresh,
  });
  const reinstate = useMutation({
    mutationFn: (bookId: string) =>
      api<unknown>(`/admin/books/${bookId}/reinstate`, { method: 'POST' }),
    onSuccess: refresh,
  });
  return { withdraw, reinstate };
}

export type Reader = {
  id: string;
  email: string;
  displayName: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
};

export type ReaderDevice = {
  id: string;
  platform: string;
  displayName: string;
  registeredAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  /** Occupies one of the reader's device slots. */
  counted: boolean;
};

export type ReaderDetail = {
  reader: Reader;
  booksOwned: number;
  devices: ReaderDevice[];
  /** Counted removals in a rolling 12 months. */
  removalsThisYear: number;
};

/** A prefix shorter than this is never sent: the server refuses it. */
export const MIN_READER_QUERY = 3;

export const useReaderSearch = (q: string) =>
  useQuery({
    queryKey: [...ADMIN, 'readers', 'search', q],
    enabled: q.length >= MIN_READER_QUERY,
    queryFn: () =>
      api<{ readers: Reader[] }>('/admin/readers', { query: { q } }).then((r) => r.readers),
    placeholderData: keepPreviousData,
  });

export const useReader = (id: string | undefined) =>
  useQuery({
    queryKey: [...ADMIN, 'reader', id],
    queryFn: () => api<ReaderDetail>(`/admin/readers/${id}`),
    enabled: id !== undefined,
    // Every view of a reader is audited, so a returning tab must not re-read it on its own.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

/** Suspend or reactivate a reader, remove one of their devices, or reset the removals count. */
export function useReaderActions(readerId: string) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: [...ADMIN, 'reader', readerId] });
  const status = useMutation({
    mutationFn: (next: 'active' | 'suspended') =>
      api<unknown>(`/admin/users/${readerId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      }),
    onSuccess: () =>
      client
        .invalidateQueries({ queryKey: [...ADMIN, 'reader'] })
        .then(() => client.invalidateQueries({ queryKey: [...ADMIN, 'readers'] })),
  });
  const removeDevice = useMutation({
    mutationFn: (deviceId: string) => api<void>(`/admin/devices/${deviceId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const resetRemovals = useMutation({
    mutationFn: () =>
      api<void>(`/admin/users/${readerId}/device-removals/reset`, { method: 'POST' }),
    onSuccess: refresh,
  });
  return { status, removeDevice, resetRemovals };
}
