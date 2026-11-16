import type { ReactNode } from 'react';
import styles from './Kicker.module.css';

/** The small uppercase label above a heading. `onDark` is for the green spotlight band. */
export function Kicker({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return <span className={`${styles.kicker} ${onDark ? styles.onDark : ''}`}>{children}</span>;
}
