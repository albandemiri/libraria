import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BookCover } from '../books/BookCover';
import { SectionHeader } from '../books/SectionHeader';
import { useLang } from '../books/useLang';
import type { Lang } from '../i18n';
import { bookHref } from '../lib/format';
import type { DiscoverSection } from '../lib/types';
import { ProgressBar } from '../ui';
import styles from './ContinueReading.module.css';
import layout from './layout.module.css';

type Item = Extract<DiscoverSection, { type: 'continue_reading' }>['items'][number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "3 ditë më parë", "dje", "last week": when the reader last opened the book, relative to `now`
 * (the loader's time, so the server and the hydrating client render the same words).
 */
function lastRead(iso: string, now: string, lang: Lang): string | null {
  const then = new Date(iso).getTime();
  const at = new Date(now).getTime();
  if (Number.isNaN(then) || Number.isNaN(at)) return null;
  const days = Math.round((then - at) / DAY_MS);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  return days > -7
    ? rtf.format(Math.min(0, days), 'day')
    : rtf.format(Math.round(days / 7), 'week');
}

/** Up to three books the signed-in reader has in progress. `now` is an ISO time from the loader. */
export function ContinueReading({ items, now }: { items: Item[]; now: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  return (
    <section className={layout.wrap} data-section="continue_reading">
      <SectionHeader
        title={t('discover.continue.title')}
        action={{ href: '/biblioteka', label: t('discover.continue.all') }}
      />
      <ul className={styles.list}>
        {items.map(({ book, percent, chapterTitle, lastReadAt }) => {
          const detail = [
            percent === null ? null : `${Math.round(percent)}%`,
            chapterTitle ?? lastRead(lastReadAt, now, lang),
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={book.id} className={styles.card}>
              <BookCover book={book} size="thumb" alt="" />
              <div className={styles.body}>
                <Link to={bookHref(book)} className={styles.title}>
                  {book.title}
                </Link>
                <span className={styles.author}>{book.author}</span>
                {percent === null ? null : (
                  <div className={styles.progress}>
                    <ProgressBar
                      value={percent}
                      label={t('discover.continue.progress', { title: book.title })}
                    />
                  </div>
                )}
                <div className={styles.row}>
                  <span>{detail}</span>
                  <Link
                    to={`/lexo/${encodeURIComponent(book.id)}`}
                    className={styles.resume}
                    aria-label={t('discover.continue.resumeTitle', { title: book.title })}
                  >
                    {t('discover.continue.resume')}
                  </Link>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
