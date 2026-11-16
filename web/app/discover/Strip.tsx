import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { BookCover } from '../books/BookCover';
import { bookHref } from '../lib/format';
import type { DiscoverSection } from '../lib/types';
import layout from './layout.module.css';
import styles from './Strip.module.css';

type Item = Extract<DiscoverSection, { type: 'strip' }>['items'][number];

/** The strip of four under the masthead: a new book, this month's number one, a genre and a publisher pick. */
export function Strip({ items }: { items: Item[] }) {
  const { t } = useTranslation();
  const label = ({ label, book }: Item) => {
    switch (label) {
      case 'genre':
        return t(`genres.${book.genre}`, { defaultValue: book.genre });
      case 'publisher':
        return t('discover.strip.publisher', { name: book.publisher.name });
      default:
        return t(`discover.strip.${label}`, { defaultValue: '' });
    }
  };

  return (
    <section className={layout.wrap} data-section="strip" aria-label={t('discover.strip.label')}>
      <ul className={styles.strip}>
        {items.map((item) => (
          <li key={`${item.label}-${item.book.id}`} className={styles.item}>
            <Link to={bookHref(item.book)} className={styles.link}>
              <BookCover book={item.book} size="thumb" alt="" />
              <span className={styles.text}>
                <span className={styles.label}>{label(item)}</span>
                <span className={styles.title}>{item.book.title}</span>
                <span className={styles.author}>{item.book.author}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
