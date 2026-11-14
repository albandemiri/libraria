import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useBooks } from '../api/books';
import type { BookStatusFilter } from '../api/types';
import DataState from '../components/DataState';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { formatMoney } from '../lib/format';

const FILTERS: BookStatusFilter[] = ['all', 'published', 'draft'];

function BooksContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const [status, setStatus] = useState<BookStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const books = useBooks(status, search, page);
  const pagination = books.data?.pagination;

  return (
    <div className="page">
      <h1>{t('pages.books')}</h1>
      <div className="filters">
        <label className="inline-field">
          <span>{t('books.search')}</span>
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className="inline-field">
          <span>{t('books.statusFilter')}</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as BookStatusFilter);
              setPage(1);
            }}
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {t(`books.filter.${f}`)}
              </option>
            ))}
          </select>
        </label>
        <Link className="btn btn-primary" to="/books/new">
          {t('pages.newBook')}
        </Link>
      </div>
      <DataState
        isPending={books.isPending}
        isError={books.isError}
        onRetry={() => void books.refetch()}
        isEmpty={books.data?.books.length === 0}
        emptyKey="books.empty"
      >
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th scope="col">{t('books.title')}</th>
                <th scope="col">{t('status.label')}</th>
                <th scope="col" className="num">
                  {t('books.price')}
                </th>
                <th scope="col" className="num">
                  {t('common.copies')}
                </th>
                <th scope="col" className="num">
                  {t('metrics.earnings')}
                </th>
              </tr>
            </thead>
            <tbody>
              {books.data?.books.map((b) => (
                <tr key={b.id}>
                  <td>
                    <Link to={`/books/${b.id}`}>{b.title}</Link>
                  </td>
                  <td>{t(b.isAvailable ? 'books.filter.published' : 'books.filter.draft')}</td>
                  <td className="num">{formatMoney(b.price.amountCents, lang)}</td>
                  <td className="num">{b.metrics.salesCount}</td>
                  <td className="num">{formatMoney(b.metrics.earningsCents, lang)}</td>
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

export default function BooksPage() {
  return (
    <ScopeGate>
      <BooksContent />
    </ScopeGate>
  );
}
