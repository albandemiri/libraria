import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { fetchSalesCsv, useSummary } from '../api/reports';
import type { Metrics } from '../api/types';
import Notice from '../components/Notice';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { usePublisherScope } from '../layout/PublisherScope';
import { saveBlob } from '../lib/download';
import { formatDay, formatMoney, formatMonth, lastDayOf } from '../lib/format';
import type { DateRange } from '../lib/periods';
import { isInProgress, monthsOfYear, weeksOfMonth, yearRange } from '../lib/statementPeriods';
import { type UrlPatch, useUrlParams } from '../lib/useUrlParams';
import { Button, ErrorState, LastUpdated, SegmentedControl, Select, StatusBadge } from '../ui';
import styles from './Financials.module.css';
import pageStyles from './Page.module.css';

type Mode = 'monthly' | 'annual';
const YEARS_SHOWN = 5;

type Problem = null | 'tooLarge' | 'error';

type RowData = {
  /** undefined while loading, null when this period has no figures to show. */
  totals: Metrics | undefined | null;
  /** Only annual rows load alone, so only they can fail alone. */
  failed?: boolean;
  onRetry?: () => void;
};

/** One statement row: backend totals for exactly its period, and a CSV of exactly that period. */
function StatementRow({
  period,
  kind,
  today,
  data,
}: {
  period: DateRange;
  kind: 'month' | 'year';
  today: Date;
  data: RowData;
}) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { publisherId } = usePublisherScope();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [partFailed, setPartFailed] = useState(false);
  const failure = useRef<HTMLDivElement>(null);
  const [failures, setFailures] = useState(0);
  const failedAttempt = problem !== null || partFailed;
  // A failed download moves focus to its message, so the reason is announced and found.
  useEffect(() => {
    if (failures > 0) failure.current?.focus();
  }, [failures]);

  const label = kind === 'month' ? formatMonth(period.from, lang) : period.from.slice(0, 4);
  // A too-large month is offered as weeks, a too-large year as its months (oldest first).
  const parts =
    kind === 'month' ? weeksOfMonth(period) : monthsOfYear(Number(label), today).reverse();
  const partLabel = (p: DateRange) =>
    kind === 'month'
      ? `${formatDay(p.from, lang)} – ${formatDay(lastDayOf(p.to), lang)}`
      : formatMonth(p.from, lang);

  async function download(range: DateRange, whole: boolean) {
    // aria-disabled keeps focus on the button, so a click while busy is ignored here.
    if (busy) return;
    setBusy(true);
    // Downloading one part keeps the list of parts on screen.
    if (whole) setProblem(null);
    setPartFailed(false);
    try {
      const blob = await fetchSalesCsv(range, lang, publisherId);
      saveBlob(blob, `libraria-sales-${range.from}-${range.to}.csv`);
    } catch (err) {
      // A 401 already went through the normal unauthorized flow.
      if (err instanceof ApiError && err.status === 401) return;
      setFailures((n) => n + 1);
      if (!whole) setPartFailed(true);
      else
        setProblem(
          err instanceof ApiError && err.code === 'EXPORT_TOO_LARGE' ? 'tooLarge' : 'error',
        );
    } finally {
      setBusy(false);
    }
  }

  const amount = (cents: number | undefined) =>
    data.totals === undefined
      ? t('common.loading')
      : data.totals === null || cents === undefined
        ? t('common.none')
        : formatMoney(cents, lang);
  return (
    <tr>
      <th scope="row" className={styles.periodCell}>
        <span>{label}</span>
        {isInProgress(period, today) && (
          <StatusBadge tone="pending">{t('statements.inProgress')}</StatusBadge>
        )}
      </th>
      {data.failed ? (
        <td colSpan={2}>
          {t('statements.loadError')}{' '}
          <Button size="sm" onClick={data.onRetry}>
            {t('common.retry')}
          </Button>
        </td>
      ) : (
        <>
          <td className={styles.amount}>{amount(data.totals?.grossCents)}</td>
          <td className={styles.amount}>{amount(data.totals?.earningsCents)}</td>
        </>
      )}
      <td>
        <div className={styles.actions}>
          <Button
            size="sm"
            aria-disabled={busy || undefined}
            aria-busy={busy || undefined}
            aria-label={t('statements.downloadFor', { period: label })}
            onClick={() => void download(period, true)}
          >
            {t('statements.download')}
          </Button>
          {failedAttempt && (
            <div ref={failure} tabIndex={-1} className={styles.failure}>
              <Notice tone="error">
                {problem === 'tooLarge'
                  ? t(kind === 'month' ? 'statements.tooLargeMonth' : 'statements.tooLargeYear')
                  : t('sales.exportErrors.generic')}
              </Notice>
            </div>
          )}
          {problem === 'tooLarge' && (
            <div className={styles.parts}>
              {parts.map((p) => (
                <Button
                  key={p.from}
                  size="sm"
                  aria-disabled={busy || undefined}
                  onClick={() => void download(p, false)}
                >
                  {t('statements.downloadPart', { part: partLabel(p) })}
                </Button>
              ))}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

/** An annual row loads its own year. */
function AnnualRow({ period, today }: { period: DateRange; today: Date }) {
  const summary = useSummary(period, 'month');
  return (
    <StatementRow
      period={period}
      kind="year"
      today={today}
      data={{
        totals: summary.data?.totals,
        failed: summary.isError,
        onRetry: () => void summary.refetch(),
      }}
    />
  );
}

function StatementsTable({ label, children }: { label: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className={styles.statement}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{t('statements.period')}</th>
            <th scope="col" className={styles.amount}>
              {t('statements.gross')}
            </th>
            <th scope="col" className={styles.amount}>
              {t('statements.earnings')}
            </th>
            <th scope="col">
              <span className="ui-sr-only">{t('statements.download')}</span>
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A month's figures are its bucket in the year's one `/summary` call: a lookup, not a sum. */
function MonthlyRows({ year, today }: { year: number; today: Date }) {
  const { t } = useTranslation();
  const summary = useSummary(yearRange(year), 'month');
  const series = summary.data?.series;
  const totalsFor = (from: string): Metrics | undefined | null => {
    if (summary.isError) return null;
    if (!series) return undefined;
    return series.find((s) => s.periodStart === from) ?? null;
  };
  return (
    <>
      {summary.isError && (
        <ErrorState body={t('statements.loadError')} onRetry={() => void summary.refetch()} />
      )}
      <div className={styles.toolbar}>
        <LastUpdated
          updatedAt={summary.dataUpdatedAt}
          isFetching={summary.isFetching}
          onRefresh={() => void summary.refetch()}
        />
      </div>
      <StatementsTable label={t('statements.monthlyTable')}>
        {monthsOfYear(year, today).map((p) => (
          <StatementRow
            key={p.from}
            period={p}
            kind="month"
            today={today}
            data={{ totals: totalsFor(p.from) }}
          />
        ))}
      </StatementsTable>
    </>
  );
}

function StatementsContent() {
  const { t } = useTranslation();
  const { params, update: patchUrl } = useUrlParams();
  // Switching view or year rewrites the history entry instead of adding one.
  const update = (patch: UrlPatch) => patchUrl(patch, true);
  const today = new Date();
  const thisYear = today.getUTCFullYear();
  const years = Array.from({ length: YEARS_SHOWN }, (_, i) => thisYear - i);
  const rawYear = params.get('year') ?? '';
  // Only a plain four-digit year counts; "2025.0", " 2025" or "1999" read as this year.
  const year =
    /^\d{4}$/.test(rawYear) && years.includes(Number(rawYear)) ? Number(rawYear) : thisYear;
  const mode: Mode = params.get('view') === 'annual' ? 'annual' : 'monthly';
  return (
    <div className={pageStyles.page}>
      <h1 className={pageStyles.title}>{t('nav.statements')}</h1>
      <p className={styles.note}>{t('statements.intro')}</p>
      <div className={styles.toolbar}>
        <SegmentedControl
          label={t('statements.mode')}
          value={mode}
          // The year only belongs to the monthly view, so annual drops it.
          onChange={(v) =>
            update(v === 'annual' ? { view: 'annual', year: undefined } : { view: undefined })
          }
          options={[
            { value: 'monthly', label: t('statements.monthly') },
            { value: 'annual', label: t('statements.annual') },
          ]}
        />
        {mode === 'monthly' && (
          <Select
            label={t('statements.year')}
            value={String(year)}
            onChange={(v) => update({ year: v === String(thisYear) ? undefined : v })}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        )}
      </div>
      {mode === 'monthly' ? (
        <MonthlyRows key={year} year={year} today={today} />
      ) : (
        <StatementsTable label={t('statements.annualTable')}>
          {years.map(yearRange).map((p) => (
            <AnnualRow key={p.from} period={p} today={today} />
          ))}
        </StatementsTable>
      )}
      <p className={styles.note}>{t('statements.pdf')}</p>
    </div>
  );
}

export default function StatementsPage() {
  return (
    <ScopeGate>
      <StatementsContent />
    </ScopeGate>
  );
}
