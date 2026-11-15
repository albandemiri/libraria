import { type FormEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { BookSort } from '../../api/types';
import { type AdminBook, useAdminBooks, useAdminPublishers, useTakedown } from '../../api/admin';
import BookStatusBadge from '../../components/BookStatusBadge';
import Notice from '../../components/Notice';
import { currentLanguage } from '../../i18n';
import { usePublisherScope } from '../../layout/PublisherScope';
import { formatDate, formatMoney } from '../../lib/format';
import {
  BOOK_STATUSES,
  MAX_SEARCH,
  type Order,
  useBookListParams,
} from '../../lib/useBookListParams';
import { useFocusFirstInvalid } from '../../lib/useFocusFirstInvalid';
import { useDebouncedUrlSearch } from '../../lib/useUrlParams';
import {
  Button,
  type Column,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  FilterBar,
  LastUpdated,
  SearchInput,
  Select,
  Textarea,
} from '../../ui';
import styles from '../Page.module.css';
import QueryView from '../QueryView';
import FocusedNotice from './FocusedNotice';
import local from './Platform.module.css';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;
const PAGE_SIZE = 20;

function WithdrawDialog({
  book,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  book: AdminBook;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();
  const { formRef, request } = useFocusFirstInvalid();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = reason.trim();
    if (!trimmed) {
      setReasonError(t('platform.booksPage.reasonRequired'));
      request();
      return;
    }
    setReasonError(undefined);
    onConfirm(trimmed);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={t('platform.booksPage.withdrawTitle', { title: book.title })}
      description={t('platform.booksPage.withdrawBody')}
      actions={
        <>
          <Button onClick={onCancel}>{t('platform.cancel')}</Button>
          <Button type="submit" form={formId} variant="danger" loading={busy}>
            {t('platform.booksPage.withdrawYes')}
          </Button>
        </>
      }
    >
      <form ref={formRef} id={formId} className={local.dialogForm} onSubmit={submit} noValidate>
        {error !== null && <FocusedNotice error={error} />}
        <Field
          label={t('platform.booksPage.reason')}
          hint={t('platform.booksPage.reasonHint')}
          error={reasonError}
          required
        >
          {(props) => (
            <Textarea
              {...props}
              className={local.reason}
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

/** Every publisher's books: find one, and take it down or lift the takedown. */
export default function PlatformBooksPage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { params, update, status, q, sort, order, page } = useBookListParams();
  const rawPublisher = params.get('publisherId') ?? '';
  const { text, setText, flush } = useDebouncedUrlSearch(q, update);
  const { setPublisherId } = usePublisherScope();
  const publishers = useAdminPublishers();
  const { withdraw, reinstate } = useTakedown();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [target, setTarget] = useState<AdminBook | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // A publisher id that is not a uuid, or not on the list, is garbage: it means "all publishers".
  // The books wait for the list, so a good id is never replaced by "all" while it loads.
  const known = publishers.data;
  const publisherId =
    UUID.test(rawPublisher) && (publishers.isError || known?.some((p) => p.id === rawPublisher))
      ? rawPublisher
      : undefined;

  const search = q.trim();
  const books = useAdminBooks(
    { q: search, status, publisherId, sort, order, page, limit: PAGE_SIZE },
    !publishers.isPending,
  );
  const rows = books.data?.books ?? [];
  const pagination = books.data?.pagination;
  const pageCount = pagination?.totalPages ?? 1;
  const filtered = status !== 'all' || search !== '' || publisherId !== undefined;
  const goToPage = (n: number) => update({ page: n <= 1 ? undefined : String(n) });
  const changeSort = (next: BookSort, nextOrder: Order) =>
    update({ sort: next, order: nextOrder, page: undefined });

  const closeDialog = () => {
    setTarget(null);
    withdraw.reset();
  };
  const onWithdraw = (reason: string) => {
    if (!target) return;
    const title = target.title;
    withdraw.mutate(
      { bookId: target.id, reason },
      {
        onSuccess: () => {
          closeDialog();
          setDone(t('platform.booksPage.withdrawn', { title }));
          headingRef.current?.focus();
        },
      },
    );
  };
  const onReinstate = (b: AdminBook) => {
    setDone(null);
    reinstate.reset();
    reinstate.mutate(b.id, {
      onSuccess: () => {
        setDone(t('platform.booksPage.reinstated', { title: b.title }));
        headingRef.current?.focus();
      },
    });
  };

  const columns: Array<Column<AdminBook>> = [
    {
      key: 'title',
      header: t('platform.books.title'),
      rowHeader: true,
      sortKey: 'title',
      cell: (b) => (
        <Link
          to={`/catalog/${b.id}`}
          className={local.cellLink}
          onClick={() => setPublisherId(b.publisherId)}
        >
          {b.title}
        </Link>
      ),
    },
    {
      key: 'publisher',
      header: t('platform.booksPage.publisher'),
      cell: (b) => <span className={local.wrapCell}>{b.publisherName}</span>,
    },
    {
      key: 'status',
      header: t('status.label'),
      cell: (b) => <BookStatusBadge status={b.status} />,
    },
    {
      key: 'price',
      header: t('platform.books.price'),
      align: 'end',
      sortKey: 'price',
      cell: (b) => formatMoney(b.price.amountCents, lang),
    },
    {
      key: 'copies',
      header: t('platform.books.copies'),
      align: 'end',
      sortKey: 'copies',
      cell: (b) => String(b.metrics.salesCount),
    },
    {
      key: 'earnings',
      header: t('platform.booksPage.earnings'),
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
      cell: (b) =>
        b.status === 'withdrawn' ? (
          <Button
            size="sm"
            aria-label={t('platform.booksPage.reinstateLabel', { title: b.title })}
            disabled={reinstate.isPending}
            onClick={() => onReinstate(b)}
          >
            {t('platform.booksPage.reinstate')}
          </Button>
        ) : (
          <Button
            size="sm"
            aria-label={t('platform.booksPage.withdrawLabel', { title: b.title })}
            onClick={() => {
              setDone(null);
              reinstate.reset();
              setTarget(b);
            }}
          >
            {t('platform.booksPage.withdraw')}
          </Button>
        ),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.sectionHead}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {t('platform.booksPage.title')}
        </h1>
        <LastUpdated
          updatedAt={books.dataUpdatedAt}
          isFetching={books.isFetching}
          onRefresh={() => void books.refetch()}
        />
      </div>

      {done && <Notice tone="info">{done}</Notice>}
      {reinstate.isError && <FocusedNotice error={reinstate.error} />}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          flush();
        }}
      >
        <FilterBar label={t('platform.booksPage.filters')}>
          <SearchInput
            value={text}
            onChange={setText}
            label={t('catalog.search')}
            maxLength={MAX_SEARCH}
          />
          <Select
            label={t('platform.booksPage.publisherFilter')}
            value={publisherId ?? ''}
            onChange={(v) => update({ publisherId: v || undefined, page: undefined })}
            options={[
              { value: '', label: t('platform.publisher.all') },
              ...(known ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label={t('catalog.statusFilter')}
            value={status}
            onChange={(v) => update({ status: v === 'all' ? undefined : v, page: undefined })}
            options={BOOK_STATUSES.map((s) => ({ value: s, label: t(`catalog.status.${s}`) }))}
          />
        </FilterBar>
      </form>

      <QueryView query={books}>
        {rows.length === 0 && pagination && pagination.total > 0 ? (
          <EmptyState
            body={t('platform.booksPage.pageOutOfRange')}
            action={<Button onClick={() => goToPage(pageCount)}>{t('catalog.lastPage')}</Button>}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            body={filtered ? t('catalog.emptyFiltered') : t('platform.booksPage.empty')}
          />
        ) : (
          <DataTable
            ariaLabel={t('platform.booksPage.table')}
            columns={columns}
            rows={rows}
            rowKey={(b) => b.id}
            sort={{ key: sort, order }}
            onSortChange={(s) => changeSort(s.key as BookSort, s.order)}
            pagination={pageCount > 1 ? { page, pageCount, onPageChange: goToPage } : undefined}
          />
        )}
      </QueryView>

      {target && (
        <WithdrawDialog
          book={target}
          busy={withdraw.isPending}
          error={withdraw.isError ? withdraw.error : null}
          onCancel={closeDialog}
          onConfirm={onWithdraw}
        />
      )}
    </div>
  );
}
