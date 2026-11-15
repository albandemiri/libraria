import type { BookSort, BookStatusFilter } from '../api/types';
import { useUrlParams } from './useUrlParams';

export const BOOK_STATUSES: readonly BookStatusFilter[] = [
  'all',
  'draft',
  'processing',
  'ready',
  'published',
  'archived',
  'withdrawn',
];
export const BOOK_SORTS: readonly BookSort[] = ['updated', 'title', 'copies', 'earnings', 'price'];
export const MAX_PAGE = 10_000;
export const MAX_SEARCH = 200;

export type Order = 'asc' | 'desc';

/** Title reads A to Z first; every number and date reads biggest or newest first. */
export const defaultOrder = (sort: BookSort): Order => (sort === 'title' ? 'asc' : 'desc');

/**
 * Status, search, sort, order and page of a book list, read from the URL so links and the back
 * button keep working. Anything unreadable means the default.
 */
export function useBookListParams() {
  const { params, update } = useUrlParams();
  const status = BOOK_STATUSES.find((s) => s === params.get('status')) ?? 'all';
  const q = (params.get('q') ?? '').slice(0, MAX_SEARCH);
  const sort = BOOK_SORTS.find((s) => s === params.get('sort')) ?? 'updated';
  const rawOrder = params.get('order');
  const order: Order = rawOrder === 'asc' || rawOrder === 'desc' ? rawOrder : defaultOrder(sort);
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1;
  return { params, update, status, q, sort, order, page };
}
