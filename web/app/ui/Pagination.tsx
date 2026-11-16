import { useTranslation } from 'react-i18next';
import styles from './Pagination.module.css';

type Props = {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
};

type Entry = number | 'gap-start' | 'gap-end';

function entries(page: number, total: number): Entry[] {
  const wanted = new Set<number>([1, total, page - 1, page, page + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: Entry[] = [];
  pages.forEach((n, i) => {
    const prev = pages[i - 1];
    if (prev !== undefined && n - prev > 1) out.push(prev < page ? 'gap-start' : 'gap-end');
    out.push(n);
  });
  return out;
}

export function Pagination({ page: rawPage, totalPages, hrefFor }: Props) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  const page = Math.min(totalPages, Math.max(1, Math.trunc(rawPage) || 1));
  return (
    <nav className={styles.pager} aria-label={t('ui.pagination')}>
      {page > 1 ? (
        <a className={`${styles.link} ${styles.word}`} href={hrefFor(page - 1)} rel="prev">
          <span aria-hidden="true">← </span>
          {t('ui.previous')}
        </a>
      ) : null}
      {entries(page, totalPages).map((entry) =>
        typeof entry === 'string' ? (
          <span key={entry} className={styles.gap} aria-hidden="true">
            …
          </span>
        ) : (
          <a
            key={entry}
            className={entry === page ? `${styles.link} ${styles.current}` : styles.link}
            href={hrefFor(entry)}
            aria-current={entry === page ? 'page' : undefined}
            aria-label={t('ui.pageN', { n: entry })}
          >
            {entry}
          </a>
        ),
      )}
      {page < totalPages ? (
        <a className={`${styles.link} ${styles.word}`} href={hrefFor(page + 1)} rel="next">
          {t('ui.next')}
          <span aria-hidden="true"> →</span>
        </a>
      ) : null}
    </nav>
  );
}
