import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useByBook, useByCountry, useSummary } from '../api/reports';
import type { Metrics, SummaryResponse } from '../api/types';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { countryName, formatMoney, formatMonth } from '../lib/format';
import type { DateRange } from '../lib/periods';
import { useDateRange } from '../lib/useDateRange';
import { type Column, DataTable, LastUpdated, NotSetUpState, SegmentedControl } from '../ui';
import styles from './Financials.module.css';
import pageStyles from './Page.module.css';
import QueryView from './QueryView';
import Section from './Section';

type View = 'month' | 'book' | 'country';
const VIEWS: View[] = ['month', 'book', 'country'];

/** Each row is one stored `Metrics` field, shown as-is. Strong rows are the stored totals of the lines above. */
const LINES: Array<{ key: string; field: keyof Metrics; strong: boolean }> = [
  { key: 'gross', field: 'grossCents', strong: false },
  { key: 'vat', field: 'taxCents', strong: false },
  { key: 'fees', field: 'feeCents', strong: false },
  { key: 'net', field: 'netCents', strong: true },
  { key: 'commission', field: 'commissionAtSaleCents', strong: false },
  { key: 'unsplit', field: 'unsplitCents', strong: false },
  { key: 'atSale', field: 'earningsAtSaleCents', strong: true },
  { key: 'reversals', field: 'earningsReversedCents', strong: false },
  { key: 'earnings', field: 'earningsCents', strong: true },
];

/** The ledger-style statement: gross down to earnings, from the backend totals, one explained line each. */
function FinancialSummary({ range, totals }: { range: DateRange; totals: Metrics }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const search = `?${new URLSearchParams({ from: range.from, to: range.to })}`;
  // Every row links to the whole period's transactions; the link does not filter by the row.
  const link = () => (
    <Link className={styles.link} to={{ pathname: '/transactions', search }}>
      {t('earnings.viewTransactions')}
    </Link>
  );
  return (
    <div className={styles.statement}>
      <table className={styles.table} aria-label={t('earnings.summaryTable')}>
        <thead>
          <tr>
            <th scope="col">{t('earnings.line')}</th>
            <th scope="col">{t('earnings.explanation')}</th>
            <th scope="col" className={styles.amount}>
              {t('earnings.amount')}
            </th>
            <th scope="col">
              <span className="ui-sr-only">{t('earnings.viewTransactions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {LINES.map((line) => {
            const label = t(`earnings.${line.key}`);
            return (
              <tr key={line.key} className={line.strong ? styles.strong : undefined}>
                <th scope="row">{label}</th>
                <td className={styles.explain}>{t(`earnings.explain.${line.key}`)}</td>
                <td className={styles.amount}>{formatMoney(totals[line.field], lang)}</td>
                <td className={styles.linkCell}>{link()}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={styles.infoRow}>
            <th scope="row">{t('earnings.refundedShort')}</th>
            <td className={styles.explain}>{t('earnings.refundedShortHint')}</td>
            <td className={styles.amount}>{formatMoney(totals.refundsCents, lang)}</td>
            <td className={styles.linkCell}>{link()}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

type WaterfallRow = {
  key: string;
  label: string;
  strong: boolean;
  /** Information only rows are muted. */
  info: boolean;
  field: keyof Metrics;
};

function MonthTable({ data }: { data: SummaryResponse }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const rows: WaterfallRow[] = [
    ...LINES.map((l) => ({
      key: l.key,
      label: t(`earnings.${l.key}`),
      strong: l.strong,
      info: false,
      field: l.field,
    })),
    {
      key: 'refunded',
      label: t('earnings.refundedInfo'),
      strong: false,
      info: true,
      field: 'refundsCents' as const,
    },
  ];
  const cell = (row: WaterfallRow, text: string) =>
    row.strong ? (
      <strong>{text}</strong>
    ) : row.info ? (
      <span className={styles.infoText}>{text}</span>
    ) : (
      text
    );
  const columns: Array<Column<WaterfallRow>> = [
    { key: 'line', header: t('earnings.line'), rowHeader: true, cell: (r) => cell(r, r.label) },
    ...data.series.map(
      (p): Column<WaterfallRow> => ({
        key: p.periodStart,
        header: formatMonth(p.periodStart, lang),
        align: 'end',
        cell: (r) => cell(r, formatMoney(p[r.field], lang)),
      }),
    ),
    {
      key: 'total',
      header: t('earnings.total'),
      align: 'end',
      cell: (r) => cell(r, formatMoney(data.totals[r.field], lang)),
    },
  ];
  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      ariaLabel={t('earnings.tableMonth')}
    />
  );
}

type Breakdown = { key: string; label: string; metrics: Metrics };

/** The same breakdown as the by-month table, one row per book or country. */
function BreakdownTable({
  rows,
  first,
  label,
}: {
  rows: Breakdown[];
  first: string;
  label: string;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const cols: Array<{ key: string; label: string; field: keyof Metrics; strong: boolean }> = [
    { key: 'copies', label: t('metrics.copies'), field: 'copies', strong: false },
    ...LINES.map((l) => ({
      key: l.key,
      label: t(`earnings.${l.key}`),
      field: l.field,
      strong: l.strong,
    })),
    { key: 'refunds', label: t('metrics.refunds'), field: 'refundsCents', strong: false },
  ];
  const columns: Array<Column<Breakdown>> = [
    { key: 'name', header: first, rowHeader: true, cell: (r) => r.label },
    ...cols.map(
      (c): Column<Breakdown> => ({
        key: c.key,
        header: c.label,
        align: 'end',
        cell: (r) => {
          const text =
            c.field === 'copies' ? String(r.metrics.copies) : formatMoney(r.metrics[c.field], lang);
          return c.strong ? <strong>{text}</strong> : text;
        },
      }),
    ),
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} ariaLabel={label} />;
}

/** "Last updated" for the query behind the visible breakdown. */
function ViewUpdated({
  query,
}: {
  query: { dataUpdatedAt: number; isFetching: boolean; refetch: () => unknown };
}) {
  return (
    <LastUpdated
      updatedAt={query.dataUpdatedAt}
      isFetching={query.isFetching}
      onRefresh={() => void query.refetch()}
    />
  );
}

function BookView({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const q = useByBook(range);
  return (
    <QueryView query={q} isEmpty={q.data?.rows.length === 0} emptyBody={t('common.empty')}>
      <ViewUpdated query={q} />
      <BreakdownTable
        first={t('common.book')}
        label={t('earnings.tableBook')}
        rows={(q.data?.rows ?? []).map((r) => ({
          key: r.book.id,
          label: r.book.title,
          metrics: r,
        }))}
      />
    </QueryView>
  );
}

function CountryView({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const q = useByCountry(range);
  return (
    <QueryView query={q} isEmpty={q.data?.rows.length === 0} emptyBody={t('common.empty')}>
      <ViewUpdated query={q} />
      <BreakdownTable
        first={t('common.country')}
        label={t('earnings.tableCountry')}
        rows={(q.data?.rows ?? []).map((r) => ({
          key: r.country ?? 'unknown',
          label: countryName(r.country, lang),
          metrics: r,
        }))}
      />
    </QueryView>
  );
}

function EarningsContent() {
  const { t } = useTranslation();
  const { range } = useDateRange();
  const [view, setView] = useState<View>('month');
  const summary = useSummary(range, 'month');
  const data = summary.data;
  return (
    <div className={pageStyles.page}>
      <div className={styles.head}>
        <h1 className={pageStyles.title}>{t('pages.earnings')}</h1>
        <LastUpdated
          updatedAt={summary.dataUpdatedAt}
          isFetching={summary.isFetching}
          onRefresh={() => void summary.refetch()}
        />
      </div>

      <Section title={t('earnings.summary')}>
        <p className={styles.note}>{t('earnings.summaryIntro')}</p>
        <QueryView query={summary}>
          {data && <FinancialSummary range={range} totals={data.totals} />}
        </QueryView>
      </Section>

      <Section
        title={t('earnings.waterfall')}
        actions={
          <SegmentedControl
            label={t('earnings.waterfallView')}
            value={view}
            onChange={(v) => setView(v as View)}
            options={VIEWS.map((v) => ({ value: v, label: t(`earnings.${v}`) }))}
          />
        }
      >
        {/* A failed summary already shows its error with a retry in the section above. */}
        {view === 'month' && !summary.isError && (
          <QueryView query={summary}>{data && <MonthTable data={data} />}</QueryView>
        )}
        {view === 'book' && <BookView range={range} />}
        {view === 'country' && <CountryView range={range} />}
        <p className={styles.note}>{t('earnings.note')}</p>
      </Section>

      <Section title={t('earnings.balances')}>
        <div className={styles.balances}>
          <NotSetUpState title={t('earnings.pendingTitle')} body={t('earnings.pendingBody')} />
          <NotSetUpState title={t('earnings.availableTitle')} body={t('earnings.availableBody')} />
          <NotSetUpState title={t('earnings.paidTitle')} body={t('earnings.paidBody')} />
        </div>
      </Section>

      <Link className={styles.card} to="/statements">
        <span className={styles.cardTitle}>{t('earnings.statements')}</span>
        <span className={styles.cardBody}>{t('earnings.statementsBody')}</span>
      </Link>
    </div>
  );
}

export default function EarningsPage() {
  return (
    <ScopeGate>
      <EarningsContent />
    </ScopeGate>
  );
}
