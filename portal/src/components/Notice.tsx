import type { ReactNode } from 'react';
import { CheckIcon, CrossIcon, InfoIcon } from '../ui/icons';
import styles from './Notice.module.css';

/** An inline message. Errors are announced at once; the others politely. Never colour alone. */
export default function Notice({
  tone,
  children,
}: {
  tone: 'error' | 'info' | 'plain';
  children: ReactNode;
}) {
  return (
    <div
      className={`${styles.notice} ${styles[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <span className={styles.icon} aria-hidden="true">
        {tone === 'error' ? <CrossIcon /> : tone === 'info' ? <CheckIcon /> : <InfoIcon />}
      </span>
      <span>{children}</span>
    </div>
  );
}
