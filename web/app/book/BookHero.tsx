import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BookCover } from '../books/BookCover';
import { Kicker } from '../books/Kicker';
import { useLang } from '../books/useLang';
import { formatDate } from '../lib/format';
import type { BookDetail, Viewer } from '../lib/types';
import styles from './BookHero.module.css';
import { PurchaseBox } from './PurchaseBox';
import type { PurchaseState } from './purchase-state';

type Props = {
  book: BookDetail;
  viewer: Viewer | null;
  state: PurchaseState;
  path: string;
  /** The pull quote (see splitDescription); null when the book has no description. */
  lede: string | null;
  checkoutKey?: string;
};

export function BookHero({ book, viewer, state, path, lede, checkoutKey }: Props) {
  const { t } = useTranslation();
  const lang = useLang();
  const genre = t(`genres.${book.genre}`, { defaultValue: book.genre });
  const byline = [
    book.publisher.name,
    book.publishedAt ? formatDate(book.publishedAt, lang, 'month') : null,
  ].filter(Boolean);

  return (
    <section className={styles.hero}>
      <div className={styles.cover}>
        <BookCover book={book} priority alt={t('book.coverAlt', { title: book.title })} />
      </div>
      <div className={styles.text}>
        <Kicker>{genre}</Kicker>
        <h1 className={styles.title}>{book.title}</h1>
        <p className={styles.by}>
          {t('book.by')}{' '}
          <Link to={`/kerko?q=${encodeURIComponent(book.author)}`} className={styles.author}>
            {book.author}
          </Link>
        </p>
        <p className={styles.publisher}>{byline.join(' · ')}</p>
        {lede ? <p className={styles.lede}>{lede}</p> : null}
        <PurchaseBox
          book={book}
          viewer={viewer}
          state={state}
          path={path}
          checkoutKey={checkoutKey}
        />
        {state === 'owned_taken_down' ? null : (
          <p className={styles.fine}>
            <b>{t('book.purchase.anywhereLead')}</b> {t('book.purchase.anywhere')}
          </p>
        )}
      </div>
    </section>
  );
}
