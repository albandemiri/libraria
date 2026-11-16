import { useEffect, useRef, useState } from 'react';
import { coverSrc } from '../lib/format';
import styles from './BookCover.module.css';

type CoverBook = { id: string; title: string; author: string; coverImageUrl: string | null };

type Props = {
  book: CoverBook;
  size?: 'thumb' | 'full';
  priority?: boolean;
  /** Pass "" when the title is printed next to the cover (cards), so it is not read twice. */
  alt?: string;
};

const DIMENSIONS = { thumb: { width: 160, height: 240 }, full: { width: 400, height: 600 } };

export function BookCover({ book, size = 'full', priority = false, alt }: Props) {
  const src = coverSrc(book, size === 'thumb' ? 'thumb' : undefined);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const label = alt ?? book.title;

  // A new cover gets a fresh chance.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the source changes
  useEffect(() => setFailed(false), [src]);

  // An error fired before hydration is never seen by React, so check the settled image.
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);

  if (!src || failed) {
    return (
      <div
        className={`${styles.cover} ${styles.fallback}`}
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      >
        <span className={styles.fallbackTitle}>{book.title}</span>
        <span className={styles.fallbackAuthor}>{book.author}</span>
      </div>
    );
  }

  return (
    <img
      ref={ref}
      className={`${styles.cover} ${styles.image}`}
      src={src}
      alt={label}
      {...DIMENSIONS[size]}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
