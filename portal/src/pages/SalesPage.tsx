import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { fetchSalesCsv, useByBook, useByCountry, useSales } from '../api/reports';
import type { SalesStatus } from '../api/types';
import ScopeGate from '../components/ScopeGate';
import DataState from '../components/DataState';
import PeriodPicker, { usePeriod } from '../components/PeriodPicker';
import { currentLanguage } from '../i18n';
import { usePublisherScope } from '../layout/PublisherScope';
import { countryName, formatDate, formatMoney, formatPercentBps } from '../lib/format';

const STATUSES: SalesStatus[] = ['paid', 'partially_refunded', 'refunded', 'disputed'];

function SalesContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { publisherId } = usePublisherScope();
  const [period, setPeriod] = usePeriod();
  const [bookId, setBookId] = useState('');
  const [country, setCountry] = useState('');
  const [status, setStatus] = useState<SalesStatus | ''>('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters = {
    ...period.range,
    bookId: bookId || undefined,
    country: country || undefined,
    status: status || undefined,
  };
  const sales = useSales(filters, page);
  const books = useByBook(period.range);
  const countries = useByCountry(period.range);

  const pagination = sales.data?.pagination;
  const feeCell = (cents: number | null) =>
    cents === null ? t('common.none') : formatMoney(cents, lang);

  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await fetchSalesCsv(filters, lang, publisherId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `libraria-sales-${filters.from}-${filters.to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      // A 401 already went through the normal unauthorized flow.
      if (err instanceof ApiError && err.status === 401) return;
      const code = err instanceof ApiError ? err.code : 'generic';
      setExportError(
        t(`sales.exportErrors.${code}`, { defaultValue: t('sales.exportErrors.generic') }),
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="page">
      <h1>{t('pages.sales')}</h1>
      <PeriodPicker
        value={period}
        onChange={(next) => {
          setPeriod(next);
          // Book and country options depend on the period, so a stale pick is dropped.
          setBookId('');
          setCountry('');
          setPage(1);
        }}
      />
      <div className="filters">
        <label className="inline-field">
          <span>{t('common.book')}</span>
          <select
            value={bookId}
            onChange={(e) => {
              setBookId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('sales.allBooks')}</option>
            {books.data?.rows.map((r) => (
              <option key={r.book.id} value={r.book.id}>
                {r.book.title}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{t('common.country')}</span>
          <select
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('sales.allCountries')}</option>
            {countries.data?.rows.map((r) => (
              <option key={r.country ?? 'unknown'} value={r.country ?? 'unknown'}>
                {countryName(r.country, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-field">
          <span>{t('status.label')}</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as SalesStatus | '');
              setPage(1);
            }}
          >
            <option value="">{t('status.all')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={exporting}
          onClick={() => void exportCsv()}
        >
          {t('sales.exportCsv')}
        </button>
      </div>
      {exportError && (
        <p role="alert" className="alert">
          {exportError}
        </p>
      )}
      <DataState
        isPending={sales.isPending}
        isError={sales.isError}
        onRetry={() => void sales.refetch()}
        isEmpty={sales.data?.lines.length === 0}
        emptyKey="sales.empty"
      >
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('sales.date')}</th>
                <th scope="col">{t('common.book')}</th>
                <th scope="col">{t('common.country')}</th>
                <th scope="col">{t('status.label')}</th>
                <th scope="col" className="num">
                  {t('sales.price')}
                </th>
                <th scope="col" className="num">
                  {t('sales.vat')}
                </th>
                <th scope="col" className="num">
                  {t('sales.fee')}
                </th>
                <th scope="col" className="num">
                  {t('sales.commissionPct')}
                </th>
                <th scope="col" className="num">
                  {t('sales.commission')}
                </th>
                <th scope="col" className="num">
                  {t('sales.earnings')}
                </th>
                <th scope="col" className="num">
                  {t('sales.refunded')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sales.data?.lines.map((line) => (
                // A transaction can hold several books, so the id alone is not unique.
                <tr key={`${line.transactionId}-${line.book.id}`}>
                  <td>{formatDate(line.paidAt, lang)}</td>
                  <td>{line.book.title}</td>
                  <td>{countryName(line.country, lang)}</td>
                  <td>{t(`status.${line.status}`)}</td>
                  <td className="num">{formatMoney(line.unitPriceCents, lang)}</td>
                  <td className="num">{formatMoney(line.taxCents, lang)}</td>
                  <td className="num">{feeCell(line.feeCents)}</td>
                  {line.split === 'done' ? (
                    <>
                      <td className="num">
                        {line.commissionRateBps === null
                          ? t('common.none')
                          : formatPercentBps(line.commissionRateBps, lang)}
                      </td>
                      <td className="num">{formatMoney(line.commissionCents, lang)}</td>
                      <td className="num">{formatMoney(line.earningsCents, lang)}</td>
                    </>
                  ) : (
                    <td colSpan={3} className="muted">
                      {line.split === 'pending' ? t('sales.feePending') : t('sales.notSplit')}
                    </td>
                  )}
                  <td className="num">{formatMoney(line.refundedCents, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pagination && pagination.totalPages > 1 && (
          <div className="pager">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              {t('common.previous')}
            </button>
            <span>{t('sales.page', { page, total: pagination.totalPages })}</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              {t('common.next')}
            </button>
          </div>
        )}
      </DataState>
    </div>
  );
}

export default function SalesPage() {
  return (
    <ScopeGate>
      <SalesContent />
    </ScopeGate>
  );
}
