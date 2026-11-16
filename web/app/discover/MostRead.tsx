import { useTranslation } from 'react-i18next';
import { BookCard } from '../books/BookCard';
import { SectionHeader } from '../books/SectionHeader';
import type { StoreBook } from '../lib/types';
import styles from './MostRead.module.css';

/** The month's most read books, ranked with large italic numerals. */
export function MostRead({ books }: { books: StoreBook[] }) {
  const { t } = useTranslation();
  return (
    <section data-section="most_read">
      <SectionHeader
        kicker={t('discover.mostRead.kicker')}
        title={t('discover.mostRead.title')}
        action={{ href: '/eksploro?sort=top', label: t('discover.mostRead.all') }}
      />
      <ol className={styles.ranked}>
        {books.map((book, index) => (
          <li key={book.id}>
            <BookCard book={book} variant="ranked" rank={index + 1} />
          </li>
        ))}
      </ol>
    </section>
  );
}
