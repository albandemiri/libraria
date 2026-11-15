import type { ReactNode } from 'react';
import styles from './Figure.module.css';

export function Figure({
  label,
  value,
  caption,
  emphasis = false,
}: {
  label: string;
  value: ReactNode;
  /** The period and the gross/net/pending meaning of the number. */
  caption?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`${styles.figure} ${emphasis ? styles.emphasis : ''}`}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{value}</dd>
      {caption && <dd className={styles.caption}>{caption}</dd>}
    </div>
  );
}

export function FigureRow({ children }: { children: ReactNode }) {
  return <dl className={styles.row}>{children}</dl>;
}
