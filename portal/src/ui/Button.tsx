import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import styles from './Button.module.css';

type Common = { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' };

export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean };

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  const cls = [styles.button, styles[variant], size === 'sm' && styles.sm, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      {...rest}
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}

export type IconButtonProps = Common &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> & {
    /** Accessible name; required because the button has no visible text. */
    label: string;
    children: ReactNode;
    ref?: Ref<HTMLButtonElement>;
  };

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const cls = [styles.button, styles[variant], styles.icon, size === 'sm' && styles.sm, className]
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} type={type} className={cls} aria-label={label} title={label}>
      {children}
    </button>
  );
}
