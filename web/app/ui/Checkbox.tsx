import type { InputHTMLAttributes, ReactNode } from 'react';
import styles from './Choice.module.css';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: ReactNode };

export function Checkbox({ label, className, ...rest }: Props) {
  return (
    <label className={[styles.choice, className].filter(Boolean).join(' ')}>
      <input {...rest} type="checkbox" className={styles.input} />
      <span>{label}</span>
    </label>
  );
}
