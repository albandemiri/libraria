import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublisherScope } from '../layout/PublisherScope';
import { EmptyState } from '../ui';

/**
 * Admins must pick a publisher before any report can load. Children are remounted when the
 * publisher changes, so filters and pages from the previous publisher never leak across.
 */
export default function ScopeGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isAdmin, publisherId } = usePublisherScope();
  if (isAdmin && publisherId === undefined) {
    return <EmptyState title={t('common.pickPublisherTitle')} body={t('common.pickPublisher')} />;
  }
  return <Fragment key={publisherId ?? 'own'}>{children}</Fragment>;
}
