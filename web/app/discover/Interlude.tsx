import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BookCover } from '../books/BookCover';
import { Kicker } from '../books/Kicker';
import { bookHref } from '../lib/format';
import type { StoreBook } from '../lib/types';
import styles from './Interlude.module.css';
import layout from './layout.module.css';

type Props = { genre: string; bookCount: number; books: StoreBook[] };

/** A quiet editorial line beside a shelf of covers from one genre. The line is static i18n copy. */
export function Interlude({ genre, bookCount, books }: Props) {
  const { t, i18n } = useTranslation();
  const lineKey = i18n.exists(`discover.interlude.lines.${genre}`)
    ? `discover.interlude.lines.${genre}`
    : 'discover.interlude.lines.default';
  const href = `/eksploro/${encodeURIComponent(genre)}`;

  return (
    <section className={layout.wrap} data-section="interlude">
      <div className={styles.interlude}>
        <div>
          <Kicker>{t(`genres.${genre}`, { defaultValue: genre })}</Kicker>
          <h2 className={styles.line}>
            <Trans t={t} i18nKey={lineKey} components={{ em: <em /> }} />
          </h2>
          <Link to={href} className={styles.browse}>
            {t('discover.interlude.browse', {
              books: t('discover.books', { count: bookCount }),
            })}
          </Link>
        </div>
        <ul className={styles.shelf}>
          {books.map((book) => (
            <li key={book.id} className={styles.slot}>
              <Link to={bookHref(book)} className={styles.book}>
                <BookCover book={book} size="thumb" alt={book.title} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
