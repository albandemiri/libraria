import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { languageLabel } from '../explore/labels';
import type { BookDetail } from '../lib/types';
import styles from './Synopsis.module.css';

/**
 * "Rreth librit": the description paragraphs the pull quote did not show (drop cap on the first),
 * then the genre and language tags. With nothing left to show it keeps the heading and the tags.
 */
export function Synopsis({ book, paragraphs }: { book: BookDetail; paragraphs: string[] }) {
  const { t } = useTranslation();
  const genre = t(`genres.${book.genre}`, { defaultValue: book.genre });

  return (
    <section className={styles.synopsis} aria-labelledby="synopsis-title" data-testid="synopsis">
      <h2 id="synopsis-title" className={styles.title}>
        {t('book.about')}
      </h2>
      {paragraphs.map((text, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: paragraphs are static and ordered
        <p key={i} className={styles.paragraph}>
          {text}
        </p>
      ))}
      <ul className={styles.tags} aria-label={t('book.tags')}>
        <li>
          <Link to={`/eksploro/${encodeURIComponent(book.genre)}`} className={styles.tag}>
            {genre}
          </Link>
        </li>
        {book.language ? <li className={styles.tag}>{languageLabel(t, book.language)}</li> : null}
      </ul>
    </section>
  );
}
