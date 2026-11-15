import { type ReactNode, useEffect, useState } from 'react';
import { resolveApiUrl } from '../api/client';
import styles from './Book.module.css';

export function BookCover({
  title,
  src,
  size,
}: {
  title: string;
  src?: string | null;
  size: 'sm' | 'md' | 'lg';
}) {
  const [failed, setFailed] = useState(false);
  // A new image gets a fresh chance to load.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when src changes
  useEffect(() => setFailed(false), [src]);
  const initial = Array.from(title.trim())[0]?.toLocaleUpperCase() ?? '?';
  return (
    <span className={`${styles.cover} ${styles[size]}`}>
      {src && !failed ? (
        <img
          className={styles.img}
          src={resolveApiUrl(src)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className={styles.fallback} aria-hidden="true">
          {initial}
        </span>
      )}
    </span>
  );
}

export function BookCard({
  title,
  author,
  cover,
  meta,
  onClick,
}: {
  title: string;
  author?: string | null;
  cover?: string | null;
  /** Status badge, price, copies sold, etc. */
  meta?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={styles.cardCover}>
        <BookCover title={title} src={cover} size="lg" />
      </span>
      <span className={styles.cardBody}>
        <span className={styles.title}>{title}</span>
        {author && <span className={styles.author}>{author}</span>}
        {meta && <span className={styles.meta}>{meta}</span>}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className={styles.card} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={styles.card}>{body}</div>
  );
}
