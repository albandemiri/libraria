import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useBooksWithStatus, useRecentBooks } from '../api/books';
import { useByBook, useSales, useSummary } from '../api/reports';
import type { Book, SalesLine } from '../api/types';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import {
  bucketLabel,
  formatChange,
  formatDate,
  formatDateTime,
  formatMoney,
  lastDayOf,
} from '../lib/format';
import { granularityFor, previousRange } from '../lib/periods';
import { useDateRange } from '../lib/useDateRange';
import {
  BarChart,
  BookCover,
  Button,
  DataTable,
  ErrorState,
  Figure,
  FigureRow,
  LastUpdated,
  LoadingState,
  NotSetUpState,
  SegmentedControl,
  StatusBadge,
} from '../ui';
import styles from './Page.module.css';
import QueryView from './QueryView';
import Section from './Section';
import { BookIcon, RefundIcon, SaleIcon } from './activityIcons';

const ACTIVITY_LIMIT = 8;

type Metric = 'grossCents' | 'earningsCents';

type Activity = {
  key: string;
  kind: 'sale' | 'refund' | 'updated';
  at: string;
  title: string;
  /** Amount in cents, exactly as the backend sent it. */
  cents?: number;
};

type ActionItem = { book: Book; reason: 'rejected' | 'ready' | 'draft' };

function actionItems(books: Book[]): ActionItem[] {
  const items: ActionItem[] = [];
  for (const book of books) {
    // An archived book is parked on purpose: nothing about it needs attention.
    if (book.status === 'archived') continue;
    if (book.latestAsset?.state === 'rejected') items.push({ book, reason: 'rejected' });
    else if (book.status === 'ready') items.push({ book, reason: 'ready' });
    else if (book.status === 'draft') items.push({ book, reason: 'draft' });
  }
  return items;
}

function mergeActivity(sales: SalesLine[], refunds: SalesLine[], books: Book[]): Activity[] {
  const events: Activity[] = [];
  const seenSale = new Set<string>();
  for (const l of sales) {
    if (seenSale.has(l.itemId)) continue;
    seenSale.add(l.itemId);
    events.push({
      key: `sale-${l.itemId}`,
      kind: 'sale',
      at: l.paidAt,
      title: l.book.title,
      cents: l.unitPriceCents,
    });
  }
  const seenRefund = new Set<string>();
  for (const l of [...sales, ...refunds]) {
    if (!l.refundedAt || seenRefund.has(l.itemId)) continue;
    seenRefund.add(l.itemId);
    events.push({
      key: `refund-${l.itemId}`,
      kind: 'refund',
      at: l.refundedAt,
      title: l.book.title,
      cents: l.refundedCents,
    });
  }
  for (const b of books.slice(0, 5)) {
    events.push({ key: `book-${b.id}`, kind: 'updated', at: b.updatedAt, title: b.title });
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, ACTIVITY_LIMIT);
}

/**
 * Comparison captions. With no gross sales in the previous period, every figure says so; if
 * only this figure was zero before, a neutral text; otherwise the % change.
 */
function useChange(previousGross: number | undefined) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  return (current: number, previous: number | undefined, loaded: boolean): string | undefined => {
    if (!loaded) return undefined;
    if (!previousGross) return t('overview.noPrevious');
    if (!previous) return t('overview.noneBefore');
    return t('overview.change', {
      change: formatChange((current - previous) / Math.abs(previous), lang),
    });
  };
}

function Figures({ range }: { range: { from: string; to: string } }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const granularity = granularityFor(range);
  const current = useSummary(range, granularity);
  const previous = useSummary(previousRange(range), granularity);
  const totals = current.data?.totals;
  const before = previous.data?.totals;
  const change = useChange(before?.grossCents);
  const loaded = previous.isSuccess;
  const period = t('overview.period', {
    from: formatDate(range.from, lang),
    to: formatDate(lastDayOf(range.to), lang),
  });

  return (
    <QueryView query={current}>
      {totals && (
        <>
          <div className={styles.hero} data-testid="hero">
            <span className={styles.heroLabel}>{t('overview.heroLabel')}</span>
            <p className={styles.heroValue}>{formatMoney(totals.earningsCents, lang)}</p>
            <p className={styles.heroCaption}>{t('overview.heroCaption')}</p>
            <p className={styles.heroCaption}>{period}</p>
            {totals.unsplitCents > 0 && (
              <p className={styles.heroCaption}>
                {t('overview.unsplitNote', { amount: formatMoney(totals.unsplitCents, lang) })}
              </p>
            )}
          </div>
          {/* biome-ignore lint/a11y/useSemanticElements: role=group names the strip of figures */}
          <div role="group" aria-label={t('overview.figures')}>
            <FigureRow>
              <Figure
                label={t('metrics.gross')}
                value={formatMoney(totals.grossCents, lang)}
                caption={change(totals.grossCents, before?.grossCents, loaded)}
              />
              <Figure
                label={t('metrics.copies')}
                value={String(totals.copies)}
                caption={change(totals.copies, before?.copies, loaded)}
              />
              <Figure
                label={t('metrics.refunds')}
                value={formatMoney(totals.refundsCents, lang)}
                caption={change(totals.refundsCents, before?.refundsCents, loaded)}
              />
              <Figure
                label={t('metrics.commissionNet')}
                value={formatMoney(totals.commissionCents, lang)}
                caption={change(totals.commissionCents, before?.commissionCents, loaded)}
              />
            </FigureRow>
          </div>
        </>
      )}
    </QueryView>
  );
}

function SalesChartSection({ range }: { range: { from: string; to: string } }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const granularity = granularityFor(range);
  const summary = useSummary(range, granularity);
  const [metric, setMetric] = useState<Metric>('grossCents');
  const [showTable, setShowTable] = useState(false);
  const series = summary.data?.series ?? [];
  const label = metric === 'grossCents' ? t('metrics.gross') : t('metrics.earnings');
  const data = series.map((p) => ({
    label: bucketLabel(p.periodStart, granularity, range.from, lang, 'axis'),
    value: p[metric],
  }));

  return (
    <Section
      title={t('overview.chartTitle')}
      actions={
        <SegmentedControl
          label={t('overview.chartMetric')}
          value={metric}
          onChange={(v) => setMetric(v as Metric)}
          options={[
            { value: 'grossCents', label: t('metrics.gross') },
            { value: 'earningsCents', label: t('metrics.earnings') },
          ]}
        />
      }
    >
      <QueryView query={summary} isEmpty={summary.isSuccess && series.length === 0}>
        {granularity !== 'day' && (
          <p className={styles.muted}>
            {granularity === 'week' ? t('overview.weekly') : t('overview.monthly')}
          </p>
        )}
        <div className={styles.panel}>
          <BarChart
            data={data}
            xKey="label"
            series={[{ key: 'value', label }]}
            ariaLabel={t('overview.chartLabel', { metric: label })}
            formatValue={(v) => formatMoney(v, lang)}
          />
        </div>
        <div>
          <Button size="sm" aria-expanded={showTable} onClick={() => setShowTable((s) => !s)}>
            {showTable ? t('overview.hideValues') : t('overview.showValues')}
          </Button>
        </div>
        {showTable && (
          <DataTable
            ariaLabel={t('overview.valuesTable')}
            rowKey={(p) => p.periodStart}
            rows={series}
            columns={[
              {
                key: 'period',
                header: t('analytics.period'),
                cell: (p) => bucketLabel(p.periodStart, granularity, range.from, lang),
              },
              {
                key: 'gross',
                header: t('metrics.gross'),
                align: 'end',
                cell: (p) => formatMoney(p.grossCents, lang),
              },
              {
                key: 'copies',
                header: t('metrics.copies'),
                align: 'end',
                cell: (p) => String(p.copies),
              },
              {
                key: 'earnings',
                header: t('metrics.earnings'),
                align: 'end',
                cell: (p) => formatMoney(p.earningsCents, lang),
              },
            ]}
          />
        )}
      </QueryView>
    </Section>
  );
}

function TopBooks({ range }: { range: { from: string; to: string } }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const byBook = useByBook(range);
  // The backend already orders by gross sales, highest first.
  const rows = (byBook.data?.rows ?? []).slice(0, 5);
  return (
    <Section title={t('overview.topBooks')}>
      <QueryView query={byBook} isEmpty={byBook.isSuccess && rows.length === 0}>
        <ul className={`${styles.list} ${styles.panel}`}>
          {rows.map((row) => (
            <li key={row.book.id} className={styles.item}>
              <BookCover
                title={row.book.title}
                src={row.book.coverThumbUrl ?? row.book.coverImageUrl}
                size="sm"
              />
              <span className={styles.grow}>
                <span className={styles.name}>{row.book.title}</span>
                <span className={styles.sub}>
                  {t('overview.copiesSold', { count: row.copies })}
                </span>
              </span>
              <span className={styles.grow} style={{ textAlign: 'end', flex: 'none' }}>
                <span className={styles.num}>{formatMoney(row.grossCents, lang)}</span>
                <span className={styles.sub}>
                  {t('metrics.earnings')}: {formatMoney(row.earningsCents, lang)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </QueryView>
    </Section>
  );
}

const ICONS = { sale: <SaleIcon />, refund: <RefundIcon />, updated: <BookIcon /> };

function RecentActivity({
  range,
  books,
}: {
  range: { from: string; to: string };
  books: ReturnType<typeof useRecentBooks>;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const sales = useSales(range, 1, 8);
  const refunded = useSales({ ...range, status: 'refunded' }, 1, 8);
  const all = [sales, refunded, books];
  const failed = all.filter((q) => q.isError);

  const events = useMemo(
    () =>
      mergeActivity(sales.data?.lines ?? [], refunded.data?.lines ?? [], books.data?.books ?? []),
    [sales.data, refunded.data, books.data],
  );

  const label = {
    sale: t('overview.sale'),
    refund: t('overview.refund'),
    updated: t('overview.bookUpdated'),
  };

  return (
    <Section title={t('overview.activity')}>
      {all.some((q) => q.isPending) && failed.length === 0 ? (
        <LoadingState />
      ) : failed.length === all.length ? (
        <ErrorState onRetry={() => failed.forEach((q) => void q.refetch())} />
      ) : (
        <>
          {failed.length > 0 && (
            <p className={styles.muted} role="alert">
              {t('overview.partial')}{' '}
              <Button size="sm" onClick={() => failed.forEach((q) => void q.refetch())}>
                {t('common.retry')}
              </Button>
            </p>
          )}
          {events.length === 0 ? (
            <p className={`${styles.muted} ${styles.emptyCard}`}>{t('overview.activityEmpty')}</p>
          ) : (
            <ul className={`${styles.list} ${styles.panel}`} aria-label={t('overview.activity')}>
              {events.map((e) => (
                <li key={e.key} className={styles.item}>
                  <span className={styles.icon}>{ICONS[e.kind]}</span>
                  <span className={styles.grow}>
                    <span className={styles.name}>{e.title}</span>
                    <span className={styles.sub}>
                      {label[e.kind]} · {formatDateTime(e.at, lang)}
                    </span>
                  </span>
                  {e.cents !== undefined && (
                    <span className={styles.num}>{formatMoney(e.cents, lang)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}

type BooksQuery = ReturnType<typeof useRecentBooks>;

function ActionItems({
  recent,
  drafts,
  ready,
}: {
  recent: BooksQuery;
  drafts: BooksQuery;
  ready: BooksQuery;
}) {
  const { t } = useTranslation();
  const queries = [recent, drafts, ready];
  const state = {
    isPending: queries.some((q) => q.isPending),
    isError: queries.some((q) => q.isError),
    refetch: () => queries.filter((q) => q.isError).forEach((q) => void q.refetch()),
  };
  // Recent books catch a rejected upload on a live book; the status lists catch every draft and
  // every ready book, however old. A book can appear in several, so keep the first.
  const seen = new Set<string>();
  const merged = [
    ...(recent.data?.books ?? []),
    ...(drafts.data?.books ?? []),
    ...(ready.data?.books ?? []),
  ].filter((b) => !seen.has(b.id) && seen.add(b.id));
  const items = actionItems(merged);
  const more = (q: BooksQuery) =>
    q.data ? Math.max(0, q.data.pagination.total - q.data.books.length) : 0;
  const moreDrafts = more(drafts);
  const moreReady = more(ready);
  const tone = { rejected: 'negative', ready: 'pending', draft: 'neutral' } as const;
  return (
    <Section title={t('overview.actions')}>
      <QueryView
        query={state}
        isEmpty={!state.isPending && items.length === 0}
        emptyBody={t('overview.actionsEmpty')}
      >
        <ul className={`${styles.list} ${styles.panel}`} aria-label={t('overview.actions')}>
          {items.map(({ book, reason }) => (
            <li key={book.id} className={styles.item}>
              <BookCover
                title={book.title}
                src={book.coverThumbUrl ?? book.coverImageUrl}
                size="sm"
              />
              <span className={styles.grow}>
                <Link to={`/catalog/${book.id}`} className={`${styles.name} ${styles.link}`}>
                  {book.title}
                </Link>
                <span className={styles.sub}>{t(`overview.action.${reason}`)}</span>
              </span>
              <StatusBadge tone={tone[reason]}>{t(`overview.actionBadge.${reason}`)}</StatusBadge>
            </li>
          ))}
          {moreDrafts > 0 && (
            <li className={styles.item}>
              <Link to="/catalog?status=draft" className={styles.link}>
                {t('overview.moreDraft', { count: moreDrafts })}
              </Link>
            </li>
          )}
          {moreReady > 0 && (
            <li className={styles.item}>
              <Link to="/catalog?status=ready" className={styles.link}>
                {t('overview.moreReady', { count: moreReady })}
              </Link>
            </li>
          )}
        </ul>
      </QueryView>
    </Section>
  );
}

function OverviewContent() {
  const { t } = useTranslation();
  const { range } = useDateRange();
  const summary = useSummary(range, granularityFor(range));
  const books = useRecentBooks();
  const drafts = useBooksWithStatus('draft');
  const ready = useBooksWithStatus('ready');

  return (
    <div className={styles.page}>
      <div className={styles.sectionHead}>
        <h1 className={styles.title}>{t('pages.overview')}</h1>
        <LastUpdated
          updatedAt={summary.dataUpdatedAt}
          isFetching={summary.isFetching}
          onRefresh={() => void summary.refetch()}
        />
      </div>
      <Figures range={range} />
      <Section title={t('overview.payouts')}>
        <NotSetUpState title={t('overview.payoutsTitle')} body={t('overview.payoutsBody')} />
      </Section>
      <SalesChartSection range={range} />
      <div className={styles.columns}>
        <TopBooks range={range} />
        <ActionItems recent={books} drafts={drafts} ready={ready} />
      </div>
      <RecentActivity range={range} books={books} />
    </div>
  );
}

export default function OverviewPage() {
  return (
    <ScopeGate>
      <OverviewContent />
    </ScopeGate>
  );
}
