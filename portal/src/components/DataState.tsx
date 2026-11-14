import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  isPending: boolean;
  isError: boolean;
  onRetry(): void;
  isEmpty?: boolean;
  emptyKey?: string;
  children: ReactNode;
};

export default function DataState({
  isPending,
  isError,
  onRetry,
  isEmpty,
  emptyKey = 'common.empty',
  children,
}: Props) {
  const { t } = useTranslation();
  if (isError) {
    return (
      <div role="alert" className="alert state">
        <span>{t('common.error')}</span>{' '}
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      </div>
    );
  }
  if (isPending) return <p className="muted state">{t('common.loading')}</p>;
  if (isEmpty) return <p className="muted state">{t(emptyKey)}</p>;
  return <>{children}</>;
}
