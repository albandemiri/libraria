import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BookCover } from '../books/BookCover';
import { Kicker } from '../books/Kicker';
import { bookHref } from '../lib/format';
import type { PublisherSummary, StoreBook } from '../lib/types';
import { Button } from '../ui';
import layout from './layout.module.css';
import styles from './PublisherSpotlight.module.css';

/**
 * "Pema e Kuqe Botime" → "PK": the first letters of the first two words, skipping lowercase
 * particles such as "e", "i" and "të" (as the mockup's "Kodra e Blertë" → "KB").
 */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const capitalised = words.filter((word) => word[0] !== word[0].toLocaleLowerCase());
  return (capitalised.length > 0 ? capitalised : words)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase();
}

type Props = { publisher: PublisherSummary; books: StoreBook[] };

/** The page's one dark band: a publisher with a monogram, a few facts and four of its books. */
export function PublisherSpotlight({ publisher, books }: Props) {
  const { t } = useTranslation();
  const nameId = useId();
  const href = `/botues/${encodeURIComponent(publisher.id)}`;
  const facts = [
    {
      value: publisher.bookCount,
      label: t('discover.spotlight.titles', { count: publisher.bookCount }),
    },
    {
      value: publisher.genres.length,
      label: t('discover.spotlight.genres', { count: publisher.genres.length }),
    },
    ...(publisher.newestYear === null
      ? []
      : [{ value: publisher.newestYear, label: t('discover.spotlight.newest') }]),
  ];

  return (
    <section
      className={`${styles.band} focusOnDark`}
      data-section="publisher_spotlight"
      data-dark=""
      aria-labelledby={nameId}
    >
      <div className={`${layout.wrap} ${styles.inner}`}>
        <div>
          <span className={styles.mono} aria-hidden="true">
            {monogram(publisher.name)}
          </span>
          <Kicker onDark>{t('discover.spotlight.kicker')}</Kicker>
          <h2 id={nameId} className={styles.name}>
            {publisher.name}
          </h2>
          <dl className={styles.facts}>
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className={styles.factLabel}>{fact.label}</dt>
                <dd className={styles.factValue}>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <Button asChild variant="onDark" size="lg">
            <Link to={href}>{t('discover.spotlight.catalogue')}</Link>
          </Button>
        </div>
        <ul className={styles.row}>
          {books.map((book) => (
            <li key={book.id}>
              <Link to={bookHref(book)} className={styles.book}>
                <BookCover book={book} size="thumb" alt="" />
                <span className={styles.title}>{book.title}</span>
                <span className={styles.author}>{book.author}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
