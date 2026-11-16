import type { HTMLAttributes } from 'react';
import styles from './VisuallyHidden.module.css';

export function VisuallyHidden({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={[styles.hidden, className].filter(Boolean).join(' ')} />;
}
