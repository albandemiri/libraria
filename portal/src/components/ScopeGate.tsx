import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePublisherScope } from '../layout/PublisherScope';

/**
 * Admins must pick a publisher before any report can load. Children are remounted when the
 * publisher changes, so filters and pages from the previous publisher never leak across.
 */
export default function ScopeGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { isAdmin, publisherId } = usePublisherScope();
  if (isAdmin && publisherId === undefined) {
    return <p className="muted state">{t('common.pickPublisher')}</p>;
  }
  return <Fragment key={publisherId ?? 'own'}>{children}</Fragment>;
}
