import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublisherScope } from '../layout/PublisherScope';
import { api } from './client';
import type { Book, BookInput, BookSort, BookStatusFilter, ContractResponse } from './types';

type BooksPage = {
  books: Book[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

/** Admins must pick a publisher first; publishers are scoped by the server. */
function useEnabled(): { publisherId: string | undefined; enabled: boolean } {
  const { publisherId, isAdmin } = usePublisherScope();
  return { publisherId, enabled: !isAdmin || publisherId !== undefined };
}

export type BookListParams = {
  status: BookStatusFilter;
  search: string;
  sort: BookSort;
  order: 'asc' | 'desc';
  page: number;
  limit?: number;
};

/** One page of the catalogue. Status, search and sort are all applied by the server. */
export function useBooks({ status, search, sort, order, page, limit = 20 }: BookListParams) {
  const { publisherId, enabled } = useEnabled();
  return useQuery({
    queryKey: ['books', 'list', publisherId, status, search, sort, order, page, limit],
    queryFn: () =>
      api<BooksPage>('/publisher/books', {
        query: {
          status,
          search: search || undefined,
          sort,
          order,
          page: String(page),
          limit: String(limit),
          publisherId,
        },
      }),
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** The newest books first, every status: for dashboards that look across the whole catalogue. */
export function useRecentBooks(limit = 50) {
  const { publisherId, enabled } = useEnabled();
  return useQuery({
    queryKey: ['books', 'recent', publisherId, limit],
    queryFn: () =>
      api<BooksPage>('/publisher/books', {
        query: { sort: 'updated', order: 'desc', limit: String(limit), publisherId },
      }),
    enabled,
  });
}

/** The newest books with one derived status, plus the total so callers can say "and N more". */
export function useBooksWithStatus(status: 'draft' | 'ready', limit = 10) {
  const { publisherId, enabled } = useEnabled();
  return useQuery({
    queryKey: ['books', 'status', publisherId, status, limit],
    queryFn: () =>
      api<BooksPage>('/publisher/books', {
        query: { status, sort: 'updated', order: 'desc', limit: String(limit), publisherId },
      }),
    enabled,
  });
}

export function useBook(id: string | undefined) {
  const { publisherId, enabled } = useEnabled();
  return useQuery({
    queryKey: ['books', 'one', publisherId, id],
    queryFn: () =>
      api<{ book: Book }>(`/publisher/books/${id}`, { query: { publisherId } }).then((r) => r.book),
    enabled: enabled && id !== undefined,
  });
}

export function useContract() {
  const { publisherId, enabled } = useEnabled();
  return useQuery({
    queryKey: ['contract', publisherId],
    queryFn: () => api<ContractResponse>('/publisher/contract', { query: { publisherId } }),
    enabled,
  });
}

/** Create, update, publish and unpublish. Admin writes carry the picked publisher. */
export function useBookMutations(id: string | undefined) {
  const { publisherId } = useEnabled();
  const client = useQueryClient();
  const done = () => client.invalidateQueries({ queryKey: ['books'] });

  const create = useMutation({
    // createBookSchema takes publisherId in the body.
    mutationFn: (input: BookInput) =>
      api<{ book: Book }>('/publisher/books', {
        method: 'POST',
        body: JSON.stringify({ ...input, publisherId }),
      }).then((r) => r.book),
    onSuccess: done,
  });
  const update = useMutation({
    // Updates and state changes take publisherId in the query.
    mutationFn: (input: BookInput) =>
      api<{ book: Book }>(`/publisher/books/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        query: { publisherId },
      }).then((r) => r.book),
    onSuccess: done,
  });
  const setPublished = useMutation({
    mutationFn: (publish: boolean) =>
      api<{ book: Book }>(`/publisher/books/${id}/${publish ? 'publish' : 'unpublish'}`, {
        method: 'POST',
        query: { publisherId },
      }).then((r) => r.book),
    onSuccess: done,
  });
  return { create, update, setPublished };
}

/**
 * Archive, restore and permanently delete. All three invalidate the books queries.
 */
export function useBookLifecycle(bookId: string) {
  const { publisherId } = useEnabled();
  const client = useQueryClient();
  const done = () => client.invalidateQueries({ queryKey: ['books'] });
  const post = (action: 'archive' | 'restore') =>
    api<{ book: Book }>(`/publisher/books/${bookId}/${action}`, {
      method: 'POST',
      query: { publisherId },
    }).then((r) => r.book);
  const archive = useMutation({ mutationFn: () => post('archive'), onSuccess: done });
  const restore = useMutation({ mutationFn: () => post('restore'), onSuccess: done });
  const remove = useMutation({
    mutationFn: () =>
      api<undefined>(`/publisher/books/${bookId}`, { method: 'DELETE', query: { publisherId } }),
    // The deleted book's own query is dropped (never refetched into a "not found"); the lists
    // are refetched. Not awaited: the caller navigates away at once.
    onSuccess: () => {
      client.removeQueries({
        queryKey: ['books', 'one'],
        predicate: (q) => q.queryKey[3] === bookId,
      });
      void client.invalidateQueries({ queryKey: ['books'] });
    },
  });
  return { archive, restore, remove };
}

/** Cover upload and removal; refetch the books so every view shows the new cover. */
export function useCoverMutations(bookId: string) {
  const { publisherId } = useEnabled();
  const client = useQueryClient();
  const done = () => client.invalidateQueries({ queryKey: ['books'] });
  const upload = useMutation({
    mutationFn: (file: File) =>
      api<{ book: Book }>(`/publisher/books/${bookId}/cover`, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        query: { publisherId },
      }),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () =>
      api<{ book: Book }>(`/publisher/books/${bookId}/cover`, {
        method: 'DELETE',
        query: { publisherId },
      }),
    onSuccess: done,
  });
  return { upload, remove };
}
