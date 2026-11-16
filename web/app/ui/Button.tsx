import {
  Children,
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import styles from './Button.module.css';

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'onDark';
  size?: 'md' | 'lg';
  loading?: boolean;
  /** Render the single child (e.g. a Link) with the button's styles and props. */
  asChild?: boolean;
  children?: ReactNode;
};

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

type AnyProps = Record<string, unknown> & { className?: string; onClick?: (e: never) => void };

/** Minimal Slot: clones the only child, merging className, handlers and other props. */
function Slot({ children, ...slotProps }: AnyProps & { children: ReactNode }) {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const el = child as ReactElement<AnyProps>;
  const childProps = el.props;
  const merged: AnyProps = { ...slotProps, ...childProps };
  merged.className = cx(slotProps.className, childProps.className);
  for (const key of Object.keys(slotProps)) {
    const a = slotProps[key];
    const b = childProps[key];
    if (/^on[A-Z]/.test(key) && typeof a === 'function' && typeof b === 'function') {
      merged[key] = (...args: unknown[]) => {
        (a as (...x: unknown[]) => void)(...args);
        // A blocked (loading/disabled) button must not run the child's own handler.
        if (!slotProps['aria-disabled']) (b as (...x: unknown[]) => void)(...args);
      };
    }
  }
  return cloneElement(el, merged);
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  asChild = false,
  disabled,
  className,
  children,
  onClick,
  type = 'button',
  ...rest
}: ButtonProps) {
  const blocked = loading || disabled;
  const classes = cx(
    styles.button,
    styles[variant],
    styles[size],
    loading && styles.loading,
    variant === 'onDark' && 'focusOnDark',
    className,
  );
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const common = {
    ...rest,
    className: classes,
    'aria-busy': loading || undefined,
    'aria-disabled': blocked || undefined,
    onClick: handleClick,
  };
  const spinner = loading ? <span className={styles.spinner} aria-hidden="true" /> : null;

  if (asChild) {
    const child = Children.only(children) as ReactElement<{ children?: ReactNode }>;
    return (
      <Slot {...common}>
        {cloneElement(
          child,
          undefined,
          <>
            <span className={styles.content}>{child.props.children}</span>
            {spinner}
          </>,
        )}
      </Slot>
    );
  }
  return (
    <button {...common} type={type} disabled={disabled && !loading}>
      <span className={styles.content}>{children}</span>
      {spinner}
    </button>
  );
}
