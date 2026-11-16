import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BookCard } from '../books/BookCard';
import type { BookDetail, StoreBook } from '../lib/types';
import styles from './BookShelves.module.css';

type Shelf = {
  key: string;
  title: string;
  description?: string;
  action?: { href: string; label: string };
  books: StoreBook[];
};

/** Same publisher, similar (same genre) and, when there is another book, more by the author. */
export function BookShelves({
  book,
  shelves,
}: {
  book: BookDetail;
  shelves: { publisher: StoreBook[]; similar: StoreBook[]; author: StoreBook[] };
}) {
  const { t } = useTranslation();
  const genre = t(`genres.${book.genre}`, { defaultValue: book.genre });
  const list: Shelf[] = [
    {
      key: 'publisher',
      title: t('book.shelves.publisher'),
      description: book.publisher.name,
      action: { href: `/botues/${book.publisher.id}`, label: t('book.shelves.publisherAction') },
      books: shelves.publisher,
    },
    {
      key: 'similar',
      title: t('book.shelves.similar'),
      description: genre,
      action: {
        href: `/eksploro/${encodeURIComponent(book.genre)}`,
        label: t('book.shelves.similarAction'),
      },
      books: shelves.similar,
    },
    {
      key: 'author',
      title: t('book.shelves.author', { author: book.author }),
      books: shelves.author,
    },
  ];

  return (
    <>
      {list
        .filter((shelf) => shelf.books.length > 0)
        .map((shelf) => (
          <section key={shelf.key} className={styles.shelf}>
            <header className={styles.header}>
              <h2 className={styles.title}>{shelf.title}</h2>
              {shelf.description ? <p className={styles.description}>{shelf.description}</p> : null}
              {shelf.action ? (
                <Link to={shelf.action.href} className={styles.action}>
                  {shelf.action.label}
                </Link>
              ) : null}
            </header>
            <ul className={styles.row}>
              {shelf.books.map((b) => (
                <li key={b.id}>
                  <BookCard book={b} variant="grid" />
                </li>
              ))}
            </ul>
          </section>
        ))}
    </>
  );
}
