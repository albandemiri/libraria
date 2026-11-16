import { useTranslation } from 'react-i18next';
import { BookCard } from '../books/BookCard';
import { SectionHeader } from '../books/SectionHeader';
import type { StoreBook } from '../lib/types';
import layout from './layout.module.css';
import styles from './NewReleases.module.css';

/** A lead book with its description, beside a grid of four with genre labels. */
export function NewReleases({ lead, books }: { lead: StoreBook; books: StoreBook[] }) {
  const { t } = useTranslation();
  return (
    <section className={layout.wrap} data-section="new_releases">
      <SectionHeader
        kicker={t('discover.newReleases.kicker')}
        title={t('discover.newReleases.title')}
        action={{ href: '/eksploro?sort=new', label: t('discover.newReleases.all') }}
      />
      <div className={styles.layout}>
        <div className={styles.lead}>
          <BookCard book={lead} variant="lead" showGenre showPublisher />
        </div>
        {books.length > 0 ? (
          <ul className={styles.grid}>
            {books.map((book) => (
              <li key={book.id}>
                <BookCard book={book} variant="grid" showGenre />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
