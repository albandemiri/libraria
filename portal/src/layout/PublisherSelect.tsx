import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { LEDGER_PARAMS } from '../lib/ledgerParams';
import { Select } from '../ui';
import { usePublisherScope } from './PublisherScope';

/** The admin-only publisher picker; renders nothing for publishers. */
export function PublisherSelect() {
  const { t } = useTranslation();
  const { publisherId, setPublisherId, publishers, isAdmin } = usePublisherScope();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [pending, setPending] = useState<string | null>(null);
  const dirty = LEDGER_PARAMS.some((key) => params.has(key));

  // Filters (a book id, a status, a search) describe one publisher's data, so they go when the
  // publisher changes. The switch waits until the URL itself is clean, so no request ever pairs
  // the new publisher with the old one's filters.
  useEffect(() => {
    if (pending !== null && !dirty) {
      setPublisherId(pending);
      setPending(null);
    }
  }, [pending, dirty, setPublisherId]);

  if (!isAdmin) return null;

  const pick = (id: string) => {
    if (!id) return;
    // A book belongs to one publisher, so another publisher's view of it would be a 404:
    // go back to the catalogue (which also drops any filters in the URL).
    if (/^\/catalog\/[^/]+/.test(pathname)) {
      navigate('/catalog', { replace: true });
      setPublisherId(id);
      return;
    }
    if (!dirty) {
      setPublisherId(id);
      return;
    }
    setPending(id);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key of LEDGER_PARAMS) next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <Select
      label={t('topbar.publisher')}
      value={publisherId ?? ''}
      onChange={pick}
      options={[
        { value: '', label: t('topbar.pickPublisher') },
        ...publishers.map((p) => ({ value: p.id, label: p.name })),
      ]}
    />
  );
}
