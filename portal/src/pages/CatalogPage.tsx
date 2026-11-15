import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useBooks } from '../api/books';
import type { Book, BookSort } from '../api/types';
import BookActions from '../components/BookActions';
import BookStatusBadge from '../components/BookStatusBadge';
import Notice from '../components/Notice';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { formatDate, formatMoney } from '../lib/format';
import {
  BOOK_SORTS,
  BOOK_STATUSES,
  MAX_SEARCH,
  type Order,
  defaultOrder,
  useBookListParams,
} from '../lib/useBookListParams';
import { useDebouncedUrlSearch } from '../lib/useUrlParams';
import {
  BookCard,
  BookCover,
  Button,
  type Column,
  DataTable,
  EmptyState,
  FilterBar,
  LastUpdated,
  SearchInput,
  SegmentedControl,
  Select,
} from '../ui';
import styles from './Catalog.module.css';
import page from './Page.module.css';
import QueryView from './QueryView';

const VIEW_KEY = 'libraria.portal.catalog.view';

type View = 'grid' | 'table';

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid';
  } catch {
    return 'grid';
  }
}

function writeView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // The choice just will not be remembered.
  }
}

function CatalogContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const navigate = useNavigate();
  // Set by BookActions after a delete. It lives in the history entry, so the next filter, search
  // or page change (a new entry without it) clears it.
  const deleted = (useLocation().state as { deleted?: string } | null)?.deleted;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // After a delete the notice is the news; focus it so keyboard and screen-reader users land there.
  useEffect(() => {
    if (deleted !== undefined) noticeRef.current?.focus();
  }, [deleted]);
  const focusHeading = () => headingRef.current?.focus();
  const { status, q, sort, order, page: pageNo, update } = useBookListParams();
  const [view, setView] = useState<View>(readView);
  const { text, setText } = useDebouncedUrlSearch(q, update);

  const search = q.trim().slice(0, MAX_SEARCH);
  const books = useBooks({ status, search, sort, order, page: pageNo });
  const list = books.data?.books ?? [];
  const pagination = books.data?.pagination;
  const filtered = status !== 'all' || search !== '';
  const open = (b: Book) => navigate(`/catalog/${b.id}`);

  const changeSort = (next: BookSort, nextOrder?: Order) =>
    update({ sort: next, order: nextOrder ?? defaultOrder(next), page: undefined });

  const columns: Array<Column<Book>> = [
    {
      key: 'cover',
      header: <span className="ui-sr-only">{t('catalog.columns.cover')}</span>,
      cell: (b) => <BookCover title={b.title} src={b.coverThumbUrl ?? b.coverImageUrl} size="sm" />,
    },
    {
      key: 'title',
      header: t('catalog.columns.title'),
      sortKey: 'title',
      cell: (b) => (
        <span className={styles.titleCell}>
          <Link to={`/catalog/${b.id}`}>{b.title}</Link>
        </span>
      ),
    },
    {
      key: 'author',
      header: t('catalog.columns.author'),
      cell: (b) => <span className={styles.clip}>{b.author || t('common.none')}</span>,
    },
    {
      key: 'isbn',
      header: t('catalog.columns.isbn'),
      cell: (b) => <span className={styles.num}>{b.isbn13 ?? t('common.none')}</span>,
    },
    {
      key: 'status',
      header: t('catalog.columns.status'),
      cell: (b) => <BookStatusBadge status={b.status} />,
    },
    {
      key: 'price',
      header: t('catalog.columns.price'),
      align: 'end',
      sortKey: 'price',
      cell: (b) => formatMoney(b.price.amountCents, lang),
    },
    {
      key: 'copies',
      header: t('catalog.columns.copies'),
      align: 'end',
      sortKey: 'copies',
      cell: (b) => String(b.metrics.salesCount),
    },
    {
      key: 'earnings',
      header: t('catalog.columns.earnings'),
      align: 'end',
      sortKey: 'earnings',
      cell: (b) => formatMoney(b.metrics.earningsCents, lang),
    },
    {
      key: 'updated',
      header: t('catalog.columns.updated'),
      sortKey: 'updated',
      cell: (b) => formatDate(b.updatedAt, lang),
    },
    {
      key: 'actions',
      header: <span className="ui-sr-only">{t('catalog.columns.actions')}</span>,
      align: 'end',
      cell: (b) => <BookActions book={b} variant="menu" onSettled={focusHeading} />,
    },
  ];

  const pageCount = pagination?.totalPages ?? 1;
  const goToPage = (n: number) => update({ page: n <= 1 ? undefined : String(n) });

  return (
    <div className={page.page}>
      <div className={styles.head}>
        <h1 ref={headingRef} tabIndex={-1} className={page.title}>
          {t('nav.catalog')}
        </h1>
        <Button variant="primary" onClick={() => navigate('/catalog/new')}>
          {t('pages.newBook')}
        </Button>
      </div>

      {deleted !== undefined && (
        <div ref={noticeRef} tabIndex={-1} className={styles.notice}>
          <Notice tone="info">{t('lifecycle.deleted', { title: deleted })}</Notice>
        </div>
      )}

      <FilterBar label={t('catalog.filters')}>
        <SearchInput
          value={text}
          onChange={setText}
          label={t('catalog.search')}
          maxLength={MAX_SEARCH}
        />
        <Select
          label={t('catalog.statusFilter')}
          value={status}
          onChange={(v) => update({ status: v === 'all' ? undefined : v, page: undefined })}
          options={BOOK_STATUSES.map((s) => ({ value: s, label: t(`catalog.status.${s}`) }))}
        />
        <Select
          label={t('catalog.sort')}
          value={sort}
          onChange={(v) => changeSort(v as BookSort)}
          options={BOOK_SORTS.map((s) => ({ value: s, label: t(`catalog.sorts.${s}`) }))}
        />
        <Select
          label={t('catalog.order')}
          value={order}
          onChange={(v) => changeSort(sort, v as Order)}
          options={[
            { value: 'asc', label: t('catalog.asc') },
            { value: 'desc', label: t('catalog.desc') },
          ]}
        />
        <SegmentedControl
          label={t('catalog.view')}
          value={view}
          onChange={(v) => {
            setView(v as View);
            writeView(v as View);
          }}
          options={[
            { value: 'grid', label: t('catalog.grid') },
            { value: 'table', label: t('catalog.table') },
          ]}
        />
      </FilterBar>

      <QueryView query={books}>
        {list.length === 0 && pagination && pagination.total > 0 ? (
          <EmptyState
            body={t('catalog.pageOutOfRange')}
            action={<Button onClick={() => goToPage(pageCount)}>{t('catalog.lastPage')}</Button>}
          />
        ) : list.length === 0 ? (
          <EmptyState
            body={filtered ? t('catalog.emptyFiltered') : t('catalog.empty')}
            action={
              filtered ? undefined : (
                <Button variant="primary" onClick={() => navigate('/catalog/new')}>
                  {t('catalog.addFirst')}
                </Button>
              )
            }
          />
        ) : view === 'grid' ? (
          <>
            <ul className={styles.grid}>
              {list.map((b) => (
                <li key={b.id} className={styles.cardItem}>
                  <BookCard
                    title={b.title}
                    author={b.author}
                    cover={b.coverThumbUrl ?? b.coverImageUrl}
                    onClick={() => open(b)}
                    meta={
                      <>
                        <span className={styles.metaRow}>
                          <BookStatusBadge status={b.status} />
                          <span>{formatMoney(b.price.amountCents, lang)}</span>
                        </span>
                        <span className={styles.metaRow}>
                          <span>{t('catalog.copies', { count: b.metrics.salesCount })}</span>
                        </span>
                        <span className={styles.metaRow}>
                          <span className={styles.muted}>{t('catalog.earned')}</span>
                          <span>{formatMoney(b.metrics.earningsCents, lang)}</span>
                        </span>
                      </>
                    }
                  />
                  <div className={styles.cardMenu}>
                    <BookActions book={b} variant="menu" onSettled={focusHeading} />
                  </div>
                </li>
              ))}
            </ul>
            {pageCount > 1 && (
              <div className={styles.pager}>
                <span>{t('ui.pageOf', { page: pageNo, count: pageCount })}</span>
                <Button size="sm" disabled={pageNo <= 1} onClick={() => goToPage(pageNo - 1)}>
                  {t('common.previous')}
                </Button>
                <Button
                  size="sm"
                  disabled={pageNo >= pageCount}
                  onClick={() => goToPage(pageNo + 1)}
                >
                  {t('common.next')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <DataTable
            ariaLabel={t('nav.catalog')}
            columns={columns}
            rows={list}
            rowKey={(b) => b.id}
            sort={{ key: sort, order }}
            onSortChange={(s) => changeSort(s.key as BookSort, s.order)}
            onRowClick={open}
            pagination={
              pageCount > 1 ? { page: pageNo, pageCount, onPageChange: goToPage } : undefined
            }
          />
        )}
      </QueryView>
      <LastUpdated
        updatedAt={books.dataUpdatedAt}
        isFetching={books.isFetching}
        onRefresh={() => void books.refetch()}
      />
    </div>
  );
}

export default function CatalogPage() {
  return (
    <ScopeGate>
      <CatalogContent />
    </ScopeGate>
  );
}
