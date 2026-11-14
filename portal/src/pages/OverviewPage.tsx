import { useTranslation } from 'react-i18next';
import { useByBook, useSummary } from '../api/reports';
import ScopeGate from '../components/ScopeGate';
import DataState from '../components/DataState';
import Kpi from '../components/Kpi';
import PeriodPicker, { usePeriod } from '../components/PeriodPicker';
import SalesChart from '../components/SalesChart';
import { currentLanguage } from '../i18n';
import { formatMoney } from '../lib/format';
import { granularityFor, previousRange } from '../lib/periods';

function OverviewContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const [period, setPeriod] = usePeriod();
  const { range } = period;
  const granularity = granularityFor(range);
  const current = useSummary(range, granularity);
  const previous = useSummary(previousRange(range), granularity);
  const byBook = useByBook(range);
  const totals = current.data?.totals;
  const before = previous.data?.totals;
  const topBooks = [...(byBook.data?.rows ?? [])]
    .sort((a, b) => b.grossCents - a.grossCents)
    .slice(0, 5);

  return (
    <div className="page">
      <h1>{t('pages.overview')}</h1>
      <PeriodPicker value={period} onChange={setPeriod} />
      <DataState
        isPending={current.isPending}
        isError={current.isError}
        onRetry={() => void current.refetch()}
      >
        {totals && (
          <>
            <div className="kpi-grid">
              <Kpi
                label={t('metrics.gross')}
                value={formatMoney(totals.grossCents, lang)}
                current={totals.grossCents}
                previous={before?.grossCents}
              />
              <Kpi
                label={t('metrics.copies')}
                value={String(totals.copies)}
                current={totals.copies}
                previous={before?.copies}
              />
              <Kpi
                label={t('metrics.refunds')}
                value={formatMoney(totals.refundsCents, lang)}
                current={totals.refundsCents}
                previous={before?.refundsCents}
              />
              <Kpi
                label={t('metrics.earnings')}
                value={formatMoney(totals.earningsCents, lang)}
                current={totals.earningsCents}
                previous={before?.earningsCents}
              />
            </div>
            <section className="card section">
              <h2>{t('overview.chartTitle')}</h2>
              <SalesChart series={current.data?.series ?? []} from={range.from} lang={lang} />
            </section>
          </>
        )}
      </DataState>
      <section className="card section">
        <h2>{t('overview.topBooks')}</h2>
        <DataState
          isPending={byBook.isPending}
          isError={byBook.isError}
          onRetry={() => void byBook.refetch()}
          isEmpty={topBooks.length === 0 && byBook.isSuccess}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{t('common.book')}</th>
                <th scope="col" className="num">
                  {t('metrics.copies')}
                </th>
                <th scope="col" className="num">
                  {t('metrics.gross')}
                </th>
                <th scope="col" className="num">
                  {t('metrics.earnings')}
                </th>
              </tr>
            </thead>
            <tbody>
              {topBooks.map((row) => (
                <tr key={row.book.id}>
                  <td>{row.book.title}</td>
                  <td className="num">{row.copies}</td>
                  <td className="num">{formatMoney(row.grossCents, lang)}</td>
                  <td className="num">{formatMoney(row.earningsCents, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataState>
      </section>
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
