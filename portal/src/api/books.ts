import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePublisherScope } from '../layout/PublisherScope';
import { api } from './client';
import type { Book, BookInput, BookStatusFilter, ContractResponse } from './types';

type BooksPage = {
  books: Book[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

/** Admins must pick a publisher first; publishers are scoped by the server. */
function useEnabled(): { publisherId: string | undefined; enabled: boolean } {
  const { publisherId, isAdmin } = usePublisherScope();
  return { publisherId, enabled: !isAdmin || publisherId !== undefined };
}

export function useBooks(status: BookStatusFilter, search: string, page: number, limit = 20) {
  const { publisherId, enabled } = useEnabled();
  return useQuery({
    queryKey: ['books', 'list', publisherId, status, search, page, limit],
    queryFn: () =>
      api<BooksPage>('/publisher/books', {
        query: {
          status,
          search: search || undefined,
          page: String(page),
          limit: String(limit),
          publisherId,
        },
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
