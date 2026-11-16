import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BookCover } from '../books/BookCover';
import { PriceTag } from '../books/PriceTag';
import { BuyForm } from '../checkout/BuyForm';
import { bookHref } from '../lib/format';
import type { StoreBook } from '../lib/types';
import { Button } from '../ui';
import styles from './FeaturedMasthead.module.css';
import layout from './layout.module.css';

/** "Zonja e Hanit të Bardhë" → ["Zonja e Hanit të ", "Bardhë"]: the last word is set in italic. */
function splitLastWord(title: string): [string, string] {
  const trimmed = title.trim();
  const at = trimmed.lastIndexOf(' ');
  return at < 0 ? ['', trimmed] : [trimmed.slice(0, at + 1), trimmed.slice(at + 1)];
}

type Props = {
  book: StoreBook;
  related: StoreBook | null;
  /** The page's idempotency key for "Bli librin" (see BuyForm). */
  checkoutKey?: string;
};

/** The pick of the week as a magazine cover story: display title, lede, actions, overlapping covers. */
export function FeaturedMasthead({ book, related, checkoutKey }: Props) {
  const { t } = useTranslation();
  const [head, last] = splitLastWord(book.title);
  const genre = t(`genres.${book.genre}`, { defaultValue: book.genre });
  const href = bookHref(book);

  let primary: React.ReactNode = null;
  if (book.owned) {
    primary = (
      <Button asChild size="lg">
        <Link to={`/lexo/${encodeURIComponent(book.id)}`}>{t('discover.featured.read')}</Link>
      </Button>
    );
  } else if (book.forSale) {
    primary = (
      <BuyForm
        action={href}
        returnTo="/"
        idempotencyKey={checkoutKey}
        label={t('discover.featured.buy')}
        className={styles.buy}
      />
    );
  }

  return (
    <section className={`${layout.wrap} ${styles.mast}`} data-section="featured">
      <div className={styles.text}>
        <h2 className={styles.title}>
          {head}
          <em>{last}</em>
        </h2>
        {book.description ? <p className={styles.lede}>{book.description}</p> : null}
        <p className={styles.by}>
          {genre} {t('discover.by')} <b>{book.author}</b>
          <span aria-hidden="true"> · </span>
          <Link
            to={`/botues/${encodeURIComponent(book.publisher.id)}`}
            className={styles.publisher}
          >
            {book.publisher.name}
          </Link>
          <span aria-hidden="true"> · </span>
          <PriceTag book={book} />
        </p>
        <div className={styles.actions}>
          {primary}
          <Button asChild size="lg" variant="secondary">
            <Link to={href}>{t('discover.featured.about')}</Link>
          </Button>
        </div>
      </div>

      <div className={styles.covers}>
        <Link to={href} className={styles.main} tabIndex={-1} aria-hidden="true">
          <BookCover book={book} priority alt="" />
        </Link>
        {related ? (
          <>
            <Link
              to={bookHref(related)}
              className={styles.related}
              tabIndex={-1}
              aria-hidden="true"
            >
              <BookCover book={related} size="thumb" alt="" />
            </Link>
            <p className={styles.caption}>
              {t('discover.featured.related')}{' '}
              <Link to={bookHref(related)}>
                <i>{related.title}</i>
              </Link>
              , {t('discover.by')} {related.author}.
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
