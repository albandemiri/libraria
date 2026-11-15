import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useBook } from '../api/books';
import { ApiError } from '../api/client';
import { useSales, useSummary } from '../api/reports';
import type { Book, SalesLine } from '../api/types';
import AssetPanel from '../components/AssetPanel';
import CoverPanel from '../components/CoverPanel';
import BookActions from '../components/BookActions';
import BookStatusBadge from '../components/BookStatusBadge';
import DistributionPanel from '../components/DistributionPanel';
import Notice from '../components/Notice';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { bucketLabel, countryName, formatDate, formatMoney } from '../lib/format';
import { granularityFor } from '../lib/periods';
import { useDateRange } from '../lib/useDateRange';
import { BarChart, BookCover, Button, type Column, DataTable, ErrorState, Tabs } from '../ui';
import styles from './BookPage.module.css';
import page from './Page.module.css';
import QueryView from './QueryView';
import Section from './Section';

const TABS = ['details', 'sales', 'analytics', 'distribution', 'files'] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | undefined): value is Tab => TABS.some((tab) => tab === value);

function Details({ book }: { book: Book }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const dash = t('common.none');
  const item = (label: string, value: string, wide = false) => (
    <div className={wide ? styles.wide : undefined} key={label}>
      <dt>{label}</dt>
      <dd className={wide ? styles.description : undefined}>{value}</dd>
    </div>
  );
  return (
    <div className={styles.tabBody}>
      <dl className={styles.details}>
        {item(t('bookPage.author'), book.author || dash)}
        {item(t('bookPage.isbn'), book.isbn13 ?? dash)}
        {item(t('bookPage.genre'), book.genre || dash)}
        {item(
          t('bookPage.language'),
          book.language
            ? t(`bookLanguages.${book.language}`, { defaultValue: book.language.toUpperCase() })
            : dash,
        )}
        {item(t('bookPage.format'), t(`bookForm.${book.mediaType}`))}
        {item(t('bookPage.price'), formatMoney(book.price.amountCents, lang))}
        {item(t('bookPage.copies'), String(book.metrics.salesCount))}
        {item(t('bookPage.earnings'), formatMoney(book.metrics.earningsCents, lang))}
        {item(
          t('bookPage.published'),
          book.publishedAt ? formatDate(book.publishedAt, lang) : dash,
        )}
        {item(t('bookPage.updated'), formatDate(book.updatedAt, lang))}
        {item(t('bookPage.description'), book.description ?? dash, true)}
      </dl>
    </div>
  );
}

function BookSales({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { range } = useDateRange();
  const [pageNo, setPageNo] = useState(1);
  // Back to the first page in the same render the range changes, so no request mixes the two.
  const rangeKey = `${range.from}|${range.to}`;
  const [seenRange, setSeenRange] = useState(rangeKey);
  if (seenRange !== rangeKey) {
    setSeenRange(rangeKey);
    setPageNo(1);
  }
  const sales = useSales({ ...range, bookId }, pageNo);
  const lines = sales.data?.lines ?? [];
  const pagination = sales.data?.pagination;

  const split = (l: SalesLine, value: number) =>
    l.split === 'done' ? formatMoney(value, lang) : t('common.none');
  const columns: Array<Column<SalesLine>> = [
    { key: 'date', header: t('sales.date'), cell: (l) => formatDate(l.paidAt, lang) },
    { key: 'country', header: t('common.country'), cell: (l) => countryName(l.country, lang) },
    { key: 'status', header: t('status.label'), cell: (l) => t(`status.${l.status}`) },
    {
      key: 'price',
      header: t('sales.price'),
      align: 'end',
      cell: (l) => formatMoney(l.unitPriceCents, lang),
    },
    {
      key: 'commission',
      header: t('sales.commission'),
      align: 'end',
      cell: (l) => split(l, l.commissionCents),
    },
    {
      key: 'earnings',
      header: t('sales.earnings'),
      align: 'end',
      cell: (l) =>
        l.split === 'done'
          ? formatMoney(l.earningsCents, lang)
          : l.split === 'pending'
            ? t('sales.feePending')
            : t('sales.notSplit'),
    },
    {
      key: 'refunded',
      header: t('sales.refunded'),
      align: 'end',
      cell: (l) => formatMoney(l.refundedCents, lang),
    },
  ];
  return (
    <div className={styles.tabBody}>
      <Section title={t('bookPage.salesTitle')}>
        <QueryView
          query={sales}
          isEmpty={sales.isSuccess && lines.length === 0}
          emptyBody={t('sales.empty')}
        >
          <DataTable
            ariaLabel={t('bookPage.salesTable')}
            rows={lines}
            rowKey={(l) => l.itemId}
            columns={columns}
            pagination={
              pagination && pagination.totalPages > 1
                ? {
                    page: pageNo,
                    pageCount: pagination.totalPages,
                    onPageChange: setPageNo,
                  }
                : undefined
            }
          />
        </QueryView>
      </Section>
    </div>
  );
}

function BookAnalytics({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { range } = useDateRange();
  const granularity = granularityFor(range);
  const summary = useSummary(range, granularity, bookId);
  const series = summary.data?.series ?? [];
  const label = (iso: string, style?: 'axis' | 'table') =>
    bucketLabel(iso, granularity, range.from, lang, style);
  const money = (v: number) => formatMoney(v, lang);
  const columns: Array<Column<(typeof series)[number]>> = [
    { key: 'period', header: t('analytics.period'), cell: (p) => label(p.periodStart) },
    { key: 'copies', header: t('metrics.copies'), align: 'end', cell: (p) => String(p.copies) },
    { key: 'gross', header: t('metrics.gross'), align: 'end', cell: (p) => money(p.grossCents) },
    {
      key: 'refunds',
      header: t('metrics.refunds'),
      align: 'end',
      cell: (p) => money(p.refundsCents),
    },
    {
      key: 'earnings',
      header: t('metrics.earnings'),
      align: 'end',
      cell: (p) => money(p.earningsCents),
    },
  ];
  return (
    <div className={styles.tabBody}>
      <Section title={t('bookPage.analyticsTitle')}>
        <QueryView query={summary} isEmpty={summary.isSuccess && series.length === 0}>
          <div className={page.panel}>
            <BarChart
              data={series.map((p) => ({
                label: label(p.periodStart, 'axis'),
                gross: p.grossCents,
                earnings: p.earningsCents,
              }))}
              xKey="label"
              series={[
                { key: 'gross', label: t('metrics.gross') },
                { key: 'earnings', label: t('metrics.earnings') },
              ]}
              ariaLabel={t('analytics.trendsChart')}
              formatValue={money}
            />
          </div>
          <DataTable
            ariaLabel={t('bookPage.analyticsTable')}
            rows={series}
            rowKey={(p) => p.periodStart}
            columns={columns}
          />
        </QueryView>
      </Section>
    </div>
  );
}

function BookContent({ book, tab }: { book: Book; tab: Tab }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { search } = useLocation();
  // When this page's book becomes archived (the Archive action), the dialog that asked closes and
  // the Archive button is gone; the new notice explains what happened, so focus goes there.
  const archived = book.status === 'archived';
  const wasArchived = useRef(archived);
  const archivedRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (archived && !wasArchived.current) archivedRef.current?.focus();
    wasArchived.current = archived;
  }, [archived]);
  // Switching tab keeps the query string, so the date range survives.
  const go = (next: string) => navigate({ pathname: `/catalog/${book.id}/${next}`, search });
  return (
    <div className={page.page}>
      <header className={styles.header}>
        <BookCover title={book.title} src={book.coverImageUrl} size="md" />
        <div className={styles.headText}>
          <Link className={styles.back} to="/catalog">
            {t('bookPage.back')}
          </Link>
          <h1 className={page.title}>{book.title}</h1>
          <p className={styles.author}>{book.author}</p>
          <div>
            <BookStatusBadge status={book.status} />
          </div>
        </div>
        <div className={styles.headActions}>
          {book.status !== 'archived' && (
            <Button onClick={() => navigate(`/catalog/${book.id}/edit`)}>
              {t('bookPage.edit')}
            </Button>
          )}
          <BookActions book={book} variant="header" />
        </div>
      </header>
      {archived && (
        <div ref={archivedRef} tabIndex={-1} className={styles.focusable}>
          <Notice tone="plain">{t('lifecycle.archivedNotice')}</Notice>
        </div>
      )}
      <Tabs
        label={t('bookPage.tabs')}
        value={tab}
        onValueChange={go}
        items={[
          { value: 'details', label: t('bookPage.tab.details'), panel: <Details book={book} /> },
          { value: 'sales', label: t('bookPage.tab.sales'), panel: <BookSales bookId={book.id} /> },
          {
            value: 'analytics',
            label: t('bookPage.tab.analytics'),
            panel: <BookAnalytics bookId={book.id} />,
          },
          {
            value: 'distribution',
            label: t('bookPage.tab.distribution'),
            panel: (
              <div className={styles.tabBody}>
                <Section title={t('bookPage.distributionTitle')}>
                  <DistributionPanel book={book} />
                </Section>
              </div>
            ),
          },
          {
            value: 'files',
            label: t('bookPage.tab.files'),
            panel: (
              <div className={styles.tabBody}>
                <Section title={t('bookPage.filesTitle')}>
                  <CoverPanel book={book} />
                  <AssetPanel bookId={book.id} disabled={book.status === 'archived'} />
                </Section>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function LoadBook({ id, tab }: { id: string; tab: Tab }) {
  const { t } = useTranslation();
  const book = useBook(id);
  if (book.isError) {
    const missing = book.error instanceof ApiError && book.error.status === 404;
    return (
      <ErrorState
        body={missing ? t('bookPage.notFound') : undefined}
        onRetry={() => void book.refetch()}
      />
    );
  }
  return (
    <QueryView query={book}>{book.data && <BookContent book={book.data} tab={tab} />}</QueryView>
  );
}

export default function BookPage() {
  const { bookId, tab } = useParams();
  if (!bookId) return <Navigate to="/catalog" replace />;
  if (tab !== undefined && !isTab(tab)) return <Navigate to={`/catalog/${bookId}`} replace />;
  return (
    <ScopeGate>
      <LoadBook id={bookId} tab={tab ?? 'details'} />
    </ScopeGate>
  );
}
