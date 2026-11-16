import type { ReactNode } from 'react';
import styles from './Chip.module.css';

type Props = { children: ReactNode } & (
  | { onRemove?: undefined; removeLabel?: undefined }
  /** `removeLabel` is the accessible name of the remove control, e.g. "Hiq filtrin Ura". */
  | { onRemove: () => void; removeLabel: string }
);

/** The chip's classes, for a chip whose remove control is a link (filter chips). */
export const chipClasses = { chip: styles.chip, remove: styles.remove } as const;

export function Chip({ children, onRemove, removeLabel }: Props) {
  return (
    <span className={styles.chip}>
      <span>{children}</span>
      {onRemove ? (
        <button type="button" className={styles.remove} onClick={onRemove} aria-label={removeLabel}>
          <span aria-hidden="true">✕</span>
        </button>
      ) : null}
    </span>
  );
}
