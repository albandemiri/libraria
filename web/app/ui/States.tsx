import type { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './States.module.css';

type StateProps = {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: StateProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.state}>
      <h2 className={styles.title}>{title ?? t('ui.emptyTitle')}</h2>
      {description ? <p className={styles.text}>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ title, description, action }: StateProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.state} role="alert">
      <h2 className={styles.title}>{title ?? t('ui.errorTitle')}</h2>
      <p className={styles.text}>{description ?? t('ui.errorDescription')}</p>
      {action}
    </div>
  );
}

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      {...rest}
      className={[styles.skeleton, className].filter(Boolean).join(' ')}
    />
  );
}
