import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { type PlatformRow, usePlatformByPublisher, usePlatformSummary } from '../../api/admin';
import { currentLanguage } from '../../i18n';
import {
  bucketLabel,
  formatDate,
  formatMoney,
  formatPercentBps,
  lastDayOf,
} from '../../lib/format';
import { granularityFor } from '../../lib/periods';
import { useDateRange } from '../../lib/useDateRange';
import {
  BarChart,
  type Column,
  DataTable,
  Figure,
  FigureRow,
  LastUpdated,
  StatusBadge,
} from '../../ui';
import styles from '../Page.module.css';
import QueryView from '../QueryView';
import Section from '../Section';
import local from './Platform.module.css';

/** Platform-wide figures. The top-bar date range applies, as on the publisher pages. */
export default function PlatformOverviewPage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { range } = useDateRange();
  const granularity = granularityFor(range);
  const summary = usePlatformSummary(range, granularity);
  const byPublisher = usePlatformByPublisher(range);

  const totals = summary.data?.totals;
  const series = summary.data?.series ?? [];
  const rows = byPublisher.data?.rows ?? [];
  const withoutRate = rows.filter((row) => row.currentRateBps === null).length;
  const chartData = series.map((p) => ({
    label: bucketLabel(p.periodStart, granularity, range.from, lang, 'axis'),
    value: p.grossCents,
  }));
  const period = t('overview.period', {
    from: formatDate(range.from, lang),
    to: formatDate(lastDayOf(range.to), lang),
  });

  const columns: Array<Column<PlatformRow>> = [
    {
      key: 'publisher',
      header: t('platform.overview.publisher'),
      rowHeader: true,
      cell: (r) => (
        <Link to={`/platform/publishers/${r.publisherId}`} className={local.cellLink}>
          {r.publisherName}
        </Link>
      ),
    },
    {
      key: 'rate',
      header: t('platform.overview.rate'),
      align: 'end',
      cell: (r) =>
        r.currentRateBps === null ? (
          <StatusBadge tone="pending">{t('platform.overview.noContract')}</StatusBadge>
        ) : (
          formatPercentBps(r.currentRateBps, lang)
        ),
    },
    {
      key: 'gross',
      header: t('metrics.gross'),
      align: 'end',
      cell: (r) => formatMoney(r.grossCents, lang),
    },
    { key: 'copies', header: t('metrics.copies'), align: 'end', cell: (r) => String(r.copies) },
    {
      key: 'commission',
      header: t('platform.overview.commission'),
      align: 'end',
      cell: (r) => formatMoney(r.commissionCents, lang),
    },
    {
      key: 'earnings',
      header: t('platform.overview.publisherEarnings'),
      align: 'end',
      cell: (r) => formatMoney(r.earningsCents, lang),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.sectionHead}>
        <h1 className={styles.title}>{t('platform.overview.title')}</h1>
        <LastUpdated
          updatedAt={summary.dataUpdatedAt}
          isFetching={summary.isFetching}
          onRefresh={() => {
            void summary.refetch();
            void byPublisher.refetch();
          }}
        />
      </div>

      <QueryView query={summary}>
        {totals && (
          <>
            <p className={styles.muted}>{period}</p>
            {/* biome-ignore lint/a11y/useSemanticElements: role=group names the strip of figures */}
            <div role="group" aria-label={t('platform.overview.figures')}>
              <FigureRow>
                <Figure label={t('metrics.gross')} value={formatMoney(totals.grossCents, lang)} />
                <Figure label={t('metrics.copies')} value={String(totals.copies)} />
                <Figure
                  label={t('metrics.refunds')}
                  value={formatMoney(totals.refundsCents, lang)}
                />
                <Figure
                  label={t('platform.overview.commission')}
                  value={formatMoney(totals.commissionCents, lang)}
                />
                <Figure
                  label={t('platform.overview.publisherEarnings')}
                  value={formatMoney(totals.earningsCents, lang)}
                />
              </FigureRow>
            </div>
          </>
        )}
      </QueryView>

      <Section title={t('platform.overview.chartTitle')}>
        <QueryView query={summary} isEmpty={summary.isSuccess && series.length === 0}>
          {granularity !== 'day' && (
            <p className={styles.muted}>
              {granularity === 'week' ? t('overview.weekly') : t('overview.monthly')}
            </p>
          )}
          <div className={styles.panel}>
            <BarChart
              data={chartData}
              xKey="label"
              series={[{ key: 'value', label: t('metrics.gross') }]}
              ariaLabel={t('platform.overview.chartLabel')}
              formatValue={(v) => formatMoney(v, lang)}
            />
          </div>
        </QueryView>
      </Section>

      <Section title={t('platform.overview.byPublisher')}>
        <QueryView
          query={byPublisher}
          isEmpty={byPublisher.isSuccess && rows.length === 0}
          emptyBody={t('platform.overview.empty')}
        >
          {withoutRate > 0 && (
            <p className={styles.muted}>{t('platform.overview.noRate', { count: withoutRate })}</p>
          )}
          <DataTable
            ariaLabel={t('platform.overview.table')}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.publisherId}
          />
        </QueryView>
      </Section>
    </div>
  );
}
