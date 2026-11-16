import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { Lang } from '../i18n';
import { bookHref, formatDate } from '../lib/format';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import type { StoreBook } from '../lib/types';
import styles from './BookCard.module.css';
import { BookCover } from './BookCover';
import { PriceTag } from './PriceTag';
import { useLang } from './useLang';

export type BookCardVariant = 'grid' | 'list' | 'ranked' | 'lead' | 'compact';

type Props = {
  book: StoreBook;
  variant: BookCardVariant;
  rank?: number;
  showPublisher?: boolean;
  showGenre?: boolean;
  lang?: Lang;
};

export function BookCard({ book, variant, rank, showPublisher, showGenre, lang }: Props) {
  const { t } = useTranslation();
  const language = useLang(lang);
  const genre = t(`genres.${book.genre}`, { defaultValue: book.genre });
  const cover = <BookCover book={book} size={variant === 'lead' ? 'full' : 'thumb'} alt="" />;
  // Non-Albanian books carry a small language tag after the title ("EN").
  const languageTag =
    book.language && book.language !== 'sq' ? (
      <>
        <span className={styles.languageTag} aria-hidden="true">
          {book.language.toUpperCase()}
        </span>
        <VisuallyHidden>
          {` (${t(`book.writtenIn.${book.language}`, { defaultValue: book.language })})`}
        </VisuallyHidden>
      </>
    ) : null;
  const title = (
    <span className={styles.title}>
      {book.title}
      {languageTag}
    </span>
  );
  const author = <span className={styles.author}>{book.author}</span>;
  const publisher =
    showPublisher && book.publisher.name ? (
      <span className={styles.publisher}>{book.publisher.name}</span>
    ) : null;
  const genreTag = showGenre && genre ? <span className={styles.genre}>{genre}</span> : null;

  let body: React.ReactNode;
  switch (variant) {
    case 'ranked':
      body = (
        <>
          <span className={styles.rank} aria-hidden={rank === undefined ? true : undefined}>
            {rank}
          </span>
          <span className={styles.thumb}>{cover}</span>
          <span className={styles.info}>
            {title}
            <span className={styles.author}>
              {book.author} · {genre}
            </span>
          </span>
          <PriceTag book={book} lang={language} />
        </>
      );
      break;
    case 'list':
      body = (
        <>
          <span className={styles.thumb}>{cover}</span>
          <span className={styles.info}>
            {genreTag}
            {title}
            {author}
            {publisher}
          </span>
          <PriceTag book={book} lang={language} />
        </>
      );
      break;
    case 'lead':
      body = (
        <>
          <span className={styles.leadCover}>{cover}</span>
          {genreTag}
          {title}
          {author}
          {publisher}
          {book.description ? <span className={styles.description}>{book.description}</span> : null}
          {book.publishedAt ? (
            <span className={styles.author}>{formatDate(book.publishedAt, language, 'month')}</span>
          ) : null}
          <PriceTag book={book} lang={language} />
        </>
      );
      break;
    case 'compact':
      body = (
        <>
          {cover}
          {title}
          {author}
        </>
      );
      break;
    default:
      body = (
        <>
          {cover}
          {genreTag}
          {title}
          {author}
          {publisher}
          <PriceTag book={book} lang={language} />
        </>
      );
  }

  return (
    <Link to={bookHref(book)} className={`${styles.card} ${styles[variant]}`}>
      {body}
    </Link>
  );
}
