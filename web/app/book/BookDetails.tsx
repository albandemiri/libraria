import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../books/useLang';
import { languageLabel } from '../explore/labels';
import { formatDate, formatIsbn13 } from '../lib/format';
import type { BookDetail } from '../lib/types';
import styles from './BookDetails.module.css';

/** The facts list. A row whose value is missing is left out. */
export function BookDetails({ book }: { book: BookDetail }) {
  const { t } = useTranslation();
  const lang = useLang();
  const rows: Array<[string, ReactNode]> = [
    [
      t('book.details.publisher'),
      <Link key="publisher" to={`/botues/${book.publisher.id}`} className={styles.link}>
        {book.publisher.name}
      </Link>,
    ],
  ];
  if (book.publishedAt) {
    rows.push([t('book.details.published'), formatDate(book.publishedAt, lang, 'day')]);
  }
  if (book.language) rows.push([t('book.details.language'), languageLabel(t, book.language)]);
  if (book.pageCount) {
    rows.push([t('book.details.length'), t('book.details.pages', { count: book.pageCount })]);
  }
  rows.push([t('book.details.format'), t('book.details.formatValue')]);
  if (book.isbn13) rows.push([t('book.details.isbn'), formatIsbn13(book.isbn13)]);

  return (
    <dl className={styles.facts} aria-label={t('book.details.label')} data-testid="book-details">
      {rows.map(([label, value]) => (
        <div key={label} className={styles.row}>
          <dt className={styles.term}>{label}</dt>
          <dd className={styles.value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
