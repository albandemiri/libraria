import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { currentLanguage, localeFor } from '../i18n';
import { Button } from './Button';
import { ClockIcon, CrossIcon, InfoIcon } from './icons';
import styles from './States.module.css';

export function EmptyState({
  title,
  body,
  action,
}: {
  title?: string;
  body?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.state}>
      <h3 className={styles.heading}>{title ?? t('ui.emptyTitle')}</h3>
      <p className={styles.body}>{body ?? t('common.empty')}</p>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className={styles.skeleton} role="status" aria-live="polite">
      <span className="ui-sr-only">{label ?? t('common.loading')}</span>
      <div className={styles.line} aria-hidden="true" />
      <div className={styles.line} aria-hidden="true" />
      <div className={styles.line} aria-hidden="true" />
    </div>
  );
}

export function ErrorState({
  title,
  body,
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.state} ${styles.error}`} role="alert">
      <span className={styles.mark} aria-hidden="true">
        <CrossIcon />
      </span>
      <h3 className={styles.heading}>{title ?? t('ui.errorTitle')}</h3>
      <p className={styles.body}>{body ?? t('common.error')}</p>
      {onRetry && (
        <div className={styles.action}>
          <Button onClick={onRetry}>{t('common.retry')}</Button>
        </div>
      )}
    </div>
  );
}

/** For features that are not built yet. Deliberately shows no figures. */
export function NotSetUpState({ title, body }: { title: string; body: string }) {
  return (
    <div className={`${styles.state} ${styles.dashed}`}>
      <span className={styles.mark} aria-hidden="true">
        <InfoIcon />
      </span>
      <h3 className={styles.heading}>{title}</h3>
      <p className={styles.body}>{body}</p>
    </div>
  );
}

export function LastUpdated({
  updatedAt,
  isFetching = false,
  onRefresh,
}: {
  /** TanStack Query's `dataUpdatedAt` (ms); 0 means there is no data yet. */
  updatedAt: number;
  isFetching?: boolean;
  onRefresh?: () => void;
}) {
  const { t } = useTranslation();
  if (!updatedAt) return null;
  const time = new Intl.DateTimeFormat(localeFor(currentLanguage()), { timeStyle: 'short' }).format(
    new Date(updatedAt),
  );
  return (
    <span className={styles.updated}>
      <ClockIcon />
      {isFetching ? t('ui.refreshing') : t('ui.lastUpdated', { time })}
      {onRefresh && (
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isFetching}>
          {t('ui.refresh')}
        </Button>
      )}
    </span>
  );
}
