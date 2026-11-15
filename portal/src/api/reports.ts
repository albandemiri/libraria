import { useQuery } from '@tanstack/react-query';
import { usePublisherScope } from '../layout/PublisherScope';
import type { DateRange, Granularity } from '../lib/periods';
import { api, apiBlob } from './client';
import type {
  ByBookRow,
  ByCountryRow,
  OrdersPage,
  SalesPage,
  SalesStatus,
  SummaryResponse,
} from './types';

export type SalesFilters = DateRange & {
  bookId?: string;
  /** ISO country code, or 'unknown' for sales with no country. */
  country?: string;
  status?: SalesStatus;
  /** Case-insensitive match on a book title or a transaction-id prefix. */
  q?: string;
};

const PREFIX = '/publisher/reports';

function useScopedQuery<T>(
  key: unknown[],
  path: string,
  query: Record<string, string | undefined>,
) {
  const { publisherId, isAdmin } = usePublisherScope();
  return useQuery({
    queryKey: ['reports', path, publisherId, ...key],
    queryFn: () => api<T>(`${PREFIX}${path}`, { query: { ...query, publisherId } }),
    // An admin must pick a publisher first; publishers are scoped by the server.
    enabled: !isAdmin || publisherId !== undefined,
  });
}

export const useSummary = (range: DateRange, granularity: Granularity, bookId?: string) =>
  useScopedQuery<SummaryResponse>([range.from, range.to, granularity, bookId], '/summary', {
    ...range,
    granularity,
    bookId,
  });

export const useByBook = (range: DateRange) =>
  useScopedQuery<{ rows: ByBookRow[] }>([range.from, range.to], '/by-book', { ...range });

export const useByCountry = (range: DateRange) =>
  useScopedQuery<{ rows: ByCountryRow[] }>([range.from, range.to], '/by-country', { ...range });

export const useSales = (filters: SalesFilters, page: number, limit = 25) =>
  useScopedQuery<SalesPage>(
    [
      filters.from,
      filters.to,
      filters.bookId,
      filters.country,
      filters.status,
      filters.q,
      page,
      limit,
    ],
    '/sales',
    { ...filters, page: String(page), limit: String(limit) },
  );

/** Sales lines grouped by order (transaction). `q` matches a book title or a transaction-id prefix. */
export const useOrders = (filters: SalesFilters, page: number, limit = 25) =>
  useScopedQuery<OrdersPage>(
    [
      filters.from,
      filters.to,
      filters.bookId,
      filters.country,
      filters.status,
      filters.q,
      page,
      limit,
    ],
    '/orders',
    { ...filters, q: filters.q || undefined, page: String(page), limit: String(limit) },
  );

/** Fetches the sales CSV (cookie + portal header) and returns the file body. */
export function fetchSalesCsv(
  filters: SalesFilters,
  lang: string,
  publisherId?: string,
): Promise<Blob> {
  return apiBlob(`${PREFIX}/sales.csv`, { query: { ...filters, publisherId, lang } });
}
