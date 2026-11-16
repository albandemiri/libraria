import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { VisuallyHidden } from './VisuallyHidden';
import styles from './Select.module.css';

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: ReactNode;
  /** Keep the label for assistive tech only (e.g. a sort control with a visible caption elsewhere). */
  hideLabel?: boolean;
  id?: string;
};

/** A native <select> styled to the mockup; the browser supplies keyboard and mobile behaviour. */
export function Select({ label, hideLabel, id, className, children, ...rest }: Props) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <div className={styles.wrap}>
      {hideLabel ? (
        <VisuallyHidden>
          <label htmlFor={selectId}>{label}</label>
        </VisuallyHidden>
      ) : (
        <label className={styles.label} htmlFor={selectId}>
          {label}
        </label>
      )}
      <span className={styles.control}>
        <select
          {...rest}
          id={selectId}
          className={[styles.select, className].filter(Boolean).join(' ')}
        >
          {children}
        </select>
        <svg className={styles.caret} viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
    </div>
  );
}
