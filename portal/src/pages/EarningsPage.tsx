import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useByBook, useByCountry, useSummary } from '../api/reports';
import type { Metrics } from '../api/types';
import ScopeGate from '../components/ScopeGate';
import DataState from '../components/DataState';
import PeriodPicker, { usePeriod } from '../components/PeriodPicker';
import { currentLanguage } from '../i18n';
import { countryName, formatMoney, formatMonth } from '../lib/format';
import type { DateRange } from '../lib/periods';

type View = 'month' | 'book' | 'country';
const VIEWS: View[] = ['month', 'book', 'country'];

/** Each row is one stored `Metrics` field, shown as-is. Bold rows are the stored totals of the lines above. */
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

function MonthTable({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const summary = useSummary(range, 'month');
  const data = summary.data;
  return (
    <DataState
      isPending={summary.isPending}
      isError={summary.isError}
      onRetry={() => void summary.refetch()}
    >
      {data && (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('earnings.line')}</th>
                {data.series.map((p) => (
                  <th scope="col" className="num" key={p.periodStart}>
                    {formatMonth(p.periodStart, lang)}
                  </th>
                ))}
                <th scope="col" className="num">
                  {t('earnings.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {LINES.map((line) => (
                <tr key={line.key} className={line.strong ? 'strong' : undefined}>
                  <th scope="row">{t(`earnings.${line.key}`)}</th>
                  {data.series.map((p) => (
                    <td className="num" key={p.periodStart}>
                      {formatMoney(p[line.field], lang)}
                    </td>
                  ))}
                  <td className="num">{formatMoney(data.totals[line.field], lang)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="muted">
                <th scope="row">{t('earnings.refundedInfo')}</th>
                {data.series.map((p) => (
                  <td className="num" key={p.periodStart}>
                    {formatMoney(p.refundsCents, lang)}
                  </td>
                ))}
                <td className="num">{formatMoney(data.totals.refundsCents, lang)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </DataState>
  );
}

function MetricsTable({
  rows,
  first,
}: {
  rows: Array<{ key: string; label: string; metrics: Metrics }>;
  first: string;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  // The same breakdown as the by-month table, one row per book or country.
  const cols: Array<{ label: string; field: keyof Metrics; strong: boolean }> = [
    { label: t('metrics.copies'), field: 'copies', strong: false },
    ...LINES.map((line) => ({
      label: t(`earnings.${line.key}`),
      field: line.field,
      strong: line.strong,
    })),
    { label: t('metrics.refunds'), field: 'refundsCents', strong: false },
  ];
  return (
    <div className="table-wrap card">
      <table>
        <thead>
          <tr>
            <th scope="col">{first}</th>
            {cols.map((c) => (
              <th scope="col" className={c.strong ? 'num strong' : 'num'} key={c.field}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              {cols.map((c) => (
                <td className={c.strong ? 'num strong' : 'num'} key={c.field}>
                  {c.field === 'copies'
                    ? row.metrics.copies
                    : formatMoney(row.metrics[c.field], lang)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BookTable({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const q = useByBook(range);
  return (
    <DataState
      isPending={q.isPending}
      isError={q.isError}
      onRetry={() => void q.refetch()}
      isEmpty={q.data?.rows.length === 0}
    >
      <MetricsTable
        first={t('common.book')}
        rows={(q.data?.rows ?? []).map((r) => ({
          key: r.book.id,
          label: r.book.title,
          metrics: r,
        }))}
      />
    </DataState>
  );
}

function CountryTable({ range }: { range: DateRange }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const q = useByCountry(range);
  return (
    <DataState
      isPending={q.isPending}
      isError={q.isError}
      onRetry={() => void q.refetch()}
      isEmpty={q.data?.rows.length === 0}
    >
      <MetricsTable
        first={t('common.country')}
        rows={(q.data?.rows ?? []).map((r) => ({
          key: r.country ?? 'unknown',
          label: countryName(r.country, lang),
          metrics: r,
        }))}
      />
    </DataState>
  );
}

function EarningsContent() {
  const { t } = useTranslation();
  const [period, setPeriod] = usePeriod('this_year');
  const [view, setView] = useState<View>('month');
  return (
    <div className="page">
      <h1>{t('pages.earnings')}</h1>
      <PeriodPicker value={period} onChange={setPeriod} />
      <fieldset className="period-picker">
        <legend className="sr-only">{t('earnings.view')}</legend>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            className="chip"
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {t(`earnings.${v}`)}
          </button>
        ))}
      </fieldset>
      {view === 'month' && <MonthTable range={period.range} />}
      {view === 'book' && <BookTable range={period.range} />}
      {view === 'country' && <CountryTable range={period.range} />}
      <p className="muted note">{t('earnings.note')}</p>
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
