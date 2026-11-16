import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Toggle.module.css';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'children'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
};

export function Toggle({ checked, onCheckedChange, label, className, onClick, ...rest }: Props) {
  return (
    <button
      {...rest}
      type="button"
      role="switch"
      aria-checked={checked}
      className={[styles.toggle, className].filter(Boolean).join(' ')}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
    >
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
      <span>{label}</span>
    </button>
  );
}
