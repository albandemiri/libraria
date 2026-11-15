import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useByBook, useByCountry, useSummary } from '../api/reports';
import type { Metrics } from '../api/types';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { bucketLabel, countryName, formatMoney } from '../lib/format';
import { type DateRange, type Granularity, granularityFor } from '../lib/periods';
import { useDateRange } from '../lib/useDateRange';
import {
  BarChart,
  BookCover,
  type Column,
  DataTable,
  LastUpdated,
  SegmentedControl,
  Tabs,
} from '../ui';
import styles from './Page.module.css';
import QueryView from './QueryView';
import Section from './Section';

type Lang = ReturnType<typeof currentLanguage>;
const money = (lang: Lang) => (v: number) => formatMoney(v, lang);

function Trends({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const [chosen, setChosen] = useState<Granularity | null>(null);
  const granularity = chosen ?? granularityFor(range);
  const summary = useSummary(range, granularity);
  const series = summary.data?.series ?? [];
  const label = (iso: string, style?: 'axis' | 'table') =>
    bucketLabel(iso, granularity, range.from, lang, style);
  const chart = series.map((p) => ({
    label: label(p.periodStart, 'axis'),
    gross: p.grossCents,
    earnings: p.earningsCents,
  }));
  const columns: Array<Column<(typeof series)[number]>> = [
    { key: 'period', header: t('analytics.period'), cell: (p) => label(p.periodStart) },
    {
      key: 'gross',
      header: t('metrics.gross'),
      align: 'end',
      cell: (p) => money(lang)(p.grossCents),
    },
    { key: 'copies', header: t('metrics.copies'), align: 'end', cell: (p) => String(p.copies) },
    {
      key: 'refunds',
      header: t('metrics.refunds'),
      align: 'end',
      cell: (p) => money(lang)(p.refundsCents),
    },
    {
      key: 'earnings',
      header: t('metrics.earnings'),
      align: 'end',
      cell: (p) => money(lang)(p.earningsCents),
    },
  ];
  return (
    <Section
      title={t('analytics.tabs.trends')}
      actions={
        <SegmentedControl
          label={t('analytics.granularity')}
          value={granularity}
          onChange={(v) => setChosen(v as Granularity)}
          options={[
            { value: 'day', label: t('analytics.day') },
            { value: 'week', label: t('analytics.week') },
            { value: 'month', label: t('analytics.month') },
          ]}
        />
      }
    >
      <QueryView query={summary} isEmpty={summary.isSuccess && series.length === 0}>
        <div className={styles.panel}>
          <BarChart
            data={chart}
            xKey="label"
            series={[
              { key: 'gross', label: t('metrics.gross') },
              { key: 'earnings', label: t('metrics.earnings') },
            ]}
            ariaLabel={t('analytics.trendsChart')}
            formatValue={money(lang)}
          />
        </div>
        <DataTable
          ariaLabel={t('analytics.trendsTable')}
          rows={series}
          rowKey={(p) => p.periodStart}
          columns={columns}
        />
      </QueryView>
    </Section>
  );
}

function metricColumns(t: (k: string) => string, lang: Lang) {
  return [
    {
      key: 'copies',
      header: t('metrics.copies'),
      align: 'end' as const,
      cell: (m: Metrics) => String(m.copies),
    },
    {
      key: 'gross',
      header: t('metrics.gross'),
      align: 'end' as const,
      cell: (m: Metrics) => money(lang)(m.grossCents),
    },
    {
      key: 'refunds',
      header: t('metrics.refunds'),
      align: 'end' as const,
      cell: (m: Metrics) => money(lang)(m.refundsCents),
    },
    {
      key: 'earnings',
      header: t('metrics.earnings'),
      align: 'end' as const,
      cell: (m: Metrics) => money(lang)(m.earningsCents),
    },
  ];
}

function Books({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const query = useByBook(range);
  const rows = query.data?.rows ?? [];
  type Row = (typeof rows)[number];
  const columns: Array<Column<Row>> = [
    {
      key: 'book',
      header: t('common.book'),
      cell: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-3)' }}>
          <BookCover
            title={r.book.title}
            src={r.book.coverThumbUrl ?? r.book.coverImageUrl}
            size="sm"
          />
          {r.book.title}
        </span>
      ),
    },
    ...metricColumns(t, lang),
  ];
  return (
    <Section title={t('analytics.tabs.books')}>
      <QueryView query={query} isEmpty={query.isSuccess && rows.length === 0}>
        {rows.length > 10 && <p className={styles.muted}>{t('analytics.top10')}</p>}
        <div className={styles.panel}>
          <BarChart
            data={rows.slice(0, 10).map((r) => ({ label: r.book.title, gross: r.grossCents }))}
            xKey="label"
            series={[{ key: 'gross', label: t('metrics.gross') }]}
            ariaLabel={t('analytics.booksChart')}
            formatValue={money(lang)}
          />
        </div>
        <DataTable
          ariaLabel={t('analytics.booksTable')}
          rows={rows}
          rowKey={(r) => r.book.id}
          columns={columns}
        />
      </QueryView>
    </Section>
  );
}

function Countries({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const query = useByCountry(range);
  const rows = query.data?.rows ?? [];
  type Row = (typeof rows)[number];
  const name = (r: Row) => countryName(r.country, lang);
  const columns: Array<Column<Row>> = [
    { key: 'country', header: t('common.country'), cell: name },
    ...metricColumns(t, lang),
  ];
  return (
    <Section title={t('analytics.tabs.countries')}>
      <QueryView query={query} isEmpty={query.isSuccess && rows.length === 0}>
        {rows.length > 10 && <p className={styles.muted}>{t('analytics.top10')}</p>}
        <div className={styles.panel}>
          <BarChart
            data={rows.slice(0, 10).map((r) => ({ label: name(r), gross: r.grossCents }))}
            xKey="label"
            series={[{ key: 'gross', label: t('metrics.gross') }]}
            ariaLabel={t('analytics.countriesChart')}
            formatValue={money(lang)}
          />
        </div>
        <DataTable
          ariaLabel={t('analytics.countriesTable')}
          rows={rows}
          rowKey={(r) => r.country ?? 'unknown'}
          columns={columns}
        />
      </QueryView>
    </Section>
  );
}

const FINANCIAL: Array<{ key: keyof Metrics; label: string }> = [
  { key: 'commissionAtSaleCents', label: 'metrics.commissionAtSale' },
  { key: 'commissionReversedCents', label: 'metrics.commissionReversed' },
  { key: 'commissionCents', label: 'metrics.commissionNet' },
  { key: 'feeCents', label: 'metrics.fees' },
  { key: 'taxCents', label: 'metrics.vat' },
  { key: 'refundsCents', label: 'metrics.refunds' },
  { key: 'unsplitCents', label: 'metrics.unsplit' },
  { key: 'earningsReversedCents', label: 'metrics.earningsReversed' },
];

function Financial({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const granularity = granularityFor(range);
  const summary = useSummary(range, granularity);
  const totals = summary.data?.totals;
  const series = summary.data?.series ?? [];
  type Point = (typeof series)[number];
  const columns: Array<Column<Point>> = [
    {
      key: 'period',
      header: t('analytics.period'),
      cell: (p) => bucketLabel(p.periodStart, granularity, range.from, lang),
    },
    ...(
      [
        ['commissionCents', 'metrics.commissionNet'],
        ['feeCents', 'metrics.fees'],
        ['refundsCents', 'metrics.refunds'],
        ['earningsReversedCents', 'metrics.earningsReversed'],
      ] as const
    ).map(([key, label]) => ({
      key,
      header: t(label),
      align: 'end' as const,
      cell: (p: Point) => money(lang)(p[key]),
    })),
  ];
  return (
    <Section title={t('analytics.tabs.financial')}>
      <QueryView query={summary}>
        {totals && (
          <DataTable
            ariaLabel={t('analytics.financialTotals')}
            rows={FINANCIAL}
            rowKey={(r) => r.key}
            columns={[
              { key: 'line', header: t('earnings.line'), cell: (r) => t(r.label) },
              {
                key: 'amount',
                header: t('analytics.amount'),
                align: 'end',
                cell: (r) => money(lang)(totals[r.key]),
              },
            ]}
          />
        )}
        {series.length > 0 && (
          <>
            <div className={styles.panel}>
              <BarChart
                data={series.map((p) => ({
                  label: bucketLabel(p.periodStart, granularity, range.from, lang, 'axis'),
                  commission: p.commissionCents,
                  fees: p.feeCents,
                  refunds: p.refundsCents,
                  reversals: p.earningsReversedCents,
                }))}
                xKey="label"
                series={[
                  { key: 'commission', label: t('metrics.commissionNet') },
                  { key: 'fees', label: t('metrics.fees') },
                  { key: 'refunds', label: t('metrics.refunds') },
                  { key: 'reversals', label: t('metrics.earningsReversed') },
                ]}
                ariaLabel={t('analytics.financialChart')}
                formatValue={money(lang)}
              />
            </div>
            <DataTable
              ariaLabel={t('analytics.financialByPeriod')}
              rows={series}
              rowKey={(p) => p.periodStart}
              columns={columns}
            />
          </>
        )}
      </QueryView>
    </Section>
  );
}

type TabId = 'trends' | 'books' | 'countries' | 'financial';

function AnalyticsContent() {
  const { t } = useTranslation();
  const { range } = useDateRange();
  const [tab, setTab] = useState<TabId>('trends');
  // Shares the Trends query, so this costs no extra request.
  const summary = useSummary(range, granularityFor(range));
  return (
    <div className={styles.page}>
      <div className={styles.sectionHead}>
        <h1 className={styles.title}>{t('nav.analytics')}</h1>
        <LastUpdated
          updatedAt={summary.dataUpdatedAt}
          isFetching={summary.isFetching}
          onRefresh={() => void summary.refetch()}
        />
      </div>
      <Tabs
        label={t('analytics.tabsLabel')}
        value={tab}
        onValueChange={(v) => setTab(v as TabId)}
        items={[
          { value: 'trends', label: t('analytics.tabs.trends'), panel: <Trends range={range} /> },
          { value: 'books', label: t('analytics.tabs.books'), panel: <Books range={range} /> },
          {
            value: 'countries',
            label: t('analytics.tabs.countries'),
            panel: <Countries range={range} />,
          },
          {
            value: 'financial',
            label: t('analytics.tabs.financial'),
            panel: <Financial range={range} />,
          },
        ]}
      />
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <ScopeGate>
      <AnalyticsContent />
    </ScopeGate>
  );
}
