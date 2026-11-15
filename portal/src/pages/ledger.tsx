import { type ReactNode, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import type { SalesFilters } from '../api/reports';
import { fetchSalesCsv, useByBook, useByCountry } from '../api/reports';
import type { SalesStatus } from '../api/types';
import { currentLanguage } from '../i18n';
import { usePublisherScope } from '../layout/PublisherScope';
import { saveBlob } from '../lib/download';
import { countryName } from '../lib/format';
import type { DateRange } from '../lib/periods';
import { useDateRange } from '../lib/useDateRange';
import { useDebouncedUrlSearch, useUrlParams } from '../lib/useUrlParams';
import styles from './Ledger.module.css';
import { FilterBar, SearchInput, Select } from '../ui';

export const STATUSES: SalesStatus[] = ['paid', 'partially_refunded', 'refunded', 'disputed'];
export const PAGE_SIZE = 25;
const MAX_PAGE = 10_000;
/** The API's limit for `q`. */
export const MAX_SEARCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COUNTRY = /^([A-Za-z]{2}|unknown)$/;

/** The short, readable form of a transaction id. */
export const shortRef = (id: string) => id.slice(0, 8);

/**
 * Search, filters and page live in the URL, so links and the back button work. Anything the API
 * would reject (a hand-edited book id, status or country) reads as "no filter".
 */
export function useLedgerParams() {
  const { params, update } = useUrlParams();
  const q = (params.get('q') ?? '').slice(0, MAX_SEARCH);
  const rawBook = params.get('book') ?? '';
  const book = UUID.test(rawBook) ? rawBook : '';
  const rawCountry = params.get('country') ?? '';
  const country = !COUNTRY.test(rawCountry)
    ? ''
    : rawCountry.toLowerCase() === 'unknown'
      ? 'unknown'
      : rawCountry.toUpperCase();
  const status = STATUSES.find((s) => s === params.get('status')) ?? undefined;
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1;

  const goToPage = useCallback(
    (n: number) => update({ page: n <= 1 ? undefined : String(n) }),
    [update],
  );
  return { q, book, country, status, page, update, goToPage };
}

export type LedgerParams = ReturnType<typeof useLedgerParams>;

/** The API filters for the current URL: range, book, country, status and the trimmed search. */
export function useLedgerFilters(params: LedgerParams): {
  range: DateRange;
  filters: SalesFilters;
  filtered: boolean;
} {
  const { range } = useDateRange();
  const search = params.q.trim().slice(0, MAX_SEARCH).trim();
  return {
    range,
    filters: {
      ...range,
      bookId: params.book || undefined,
      country: params.country || undefined,
      status: params.status,
      q: search || undefined,
    },
    filtered:
      search !== '' || params.book !== '' || params.country !== '' || params.status !== undefined,
  };
}

/** What the API receives for a search box text: trimmed and within the API's limit. */
const normaliseSearch = (text: string) => text.slice(0, MAX_SEARCH).trim() || undefined;

/** The search box text, debounced into the URL; see `useDebouncedUrlSearch`. */
export function useLedgerSearch(params: LedgerParams) {
  return useDebouncedUrlSearch(params.q, params.update);
}

export type LedgerSearch = ReturnType<typeof useLedgerSearch>;

/** Search box + book, country and status selects. */
export function LedgerControls({
  params,
  range,
  label,
  search,
}: {
  params: LedgerParams;
  range: DateRange;
  label: string;
  search: LedgerSearch;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { book, country, status, update } = params;
  const books = useByBook(range);
  const countries = useByCountry(range);
  const { text, setText } = search;

  const bookOptions = [
    { value: '', label: t('sales.allBooks') },
    ...(books.data?.rows ?? []).map((r) => ({ value: r.book.id, label: r.book.title })),
  ];
  if (book && !bookOptions.some((o) => o.value === book)) {
    bookOptions.push({ value: book, label: t('sales.unknownBook') });
  }
  const countryOptions = [
    { value: '', label: t('sales.allCountries') },
    ...(countries.data?.rows ?? []).map((r) => ({
      value: r.country ?? 'unknown',
      label: countryName(r.country, lang),
    })),
  ];
  if (country && !countryOptions.some((o) => o.value === country)) {
    countryOptions.push({ value: country, label: country });
  }

  return (
    <FilterBar label={label}>
      <SearchInput
        value={text}
        onChange={setText}
        label={t('sales.search')}
        maxLength={MAX_SEARCH}
      />
      <Select
        label={t('common.book')}
        value={book}
        onChange={(v) => update({ book: v, page: undefined })}
        options={bookOptions}
      />
      <Select
        label={t('common.country')}
        value={country}
        onChange={(v) => update({ country: v, page: undefined })}
        options={countryOptions}
      />
      <Select
        label={t('status.label')}
        value={status ?? ''}
        onChange={(v) => update({ status: v, page: undefined })}
        options={[
          { value: '', label: t('status.all') },
          ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
        ]}
      />
    </FilterBar>
  );
}

/** CSV export with the page's current filters. Errors are translated by their API code. */
export function useCsvExport(filters: SalesFilters, search: LedgerSearch) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { publisherId } = usePublisherScope();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setExporting(true);
    setError(null);
    try {
      // Pending typing counts: the export uses the text in the box, not the last applied search.
      search.flush();
      const current = { ...filters, q: normaliseSearch(search.text) };
      const blob = await fetchSalesCsv(current, lang, publisherId);
      saveBlob(blob, `libraria-sales-${filters.from}-${filters.to}.csv`);
    } catch (err) {
      // A 401 already went through the normal unauthorized flow.
      if (err instanceof ApiError && err.status === 401) return;
      const code = err instanceof ApiError ? err.code : 'generic';
      setError(t(`sales.exportErrors.${code}`, { defaultValue: t('sales.exportErrors.generic') }));
    } finally {
      setExporting(false);
    }
  }
  return { exporting, error, run };
}

/** The keyboard and screen-reader way into a row: a real button (the row click is mouse-only). */
export function OpenButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={styles.openBtn} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

/** Calls `onChange` once, during the render in which `key` changes (state reset without an effect). */
export function useOnChange(key: string, onChange: () => void): void {
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    onChange();
  }
}
