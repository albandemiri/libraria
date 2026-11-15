import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MIN_READER_QUERY, type Reader, useReaderSearch } from '../../api/admin';
import { currentLanguage } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useDebouncedUrlSearch, useUrlParams } from '../../lib/useUrlParams';
import {
  Button,
  type Column,
  DataTable,
  FilterBar,
  LoadingState,
  SearchInput,
  StatusBadge,
} from '../../ui';
import styles from '../Page.module.css';
import FocusedNotice from './FocusedNotice';
import local from './Platform.module.css';

const MAX_SEARCH = 254;
/** The server returns at most this many matches. */
const MAX_RESULTS = 20;

export default function ReadersPage() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { params, update } = useUrlParams();
  const q = (params.get('q') ?? '').slice(0, MAX_SEARCH);
  const { text, setText, flush } = useDebouncedUrlSearch(q, update);
  const term = q.trim();
  // Under the minimum nothing is sent: the server would refuse it, and a short prefix browses everyone.
  const searching = term.length >= MIN_READER_QUERY;
  const results = useReaderSearch(term);
  const rows = results.data ?? [];

  const columns: Array<Column<Reader>> = [
    {
      key: 'email',
      header: t('platform.team.email'),
      rowHeader: true,
      cell: (r) => (
        <Link to={`/platform/readers/${r.id}`} className={local.cellLink}>
          {r.email}
        </Link>
      ),
    },
    {
      key: 'name',
      header: t('platform.team.name'),
      cell: (r) => r.displayName ?? t('common.none'),
    },
    {
      key: 'status',
      header: t('status.label'),
      cell: (r) => (
        <StatusBadge tone={r.status === 'active' ? 'positive' : 'negative'}>
          {t(`platform.team.status.${r.status}`)}
        </StatusBadge>
      ),
    },
    {
      key: 'created',
      header: t('platform.team.created'),
      cell: (r) => formatDate(r.createdAt, lang),
    },
  ];

  const errored = searching && results.isError;
  let body = null;
  if (!searching) {
    body = <p className={styles.muted}>{t('platform.readers.hint', { min: MIN_READER_QUERY })}</p>;
  } else if (results.isError) {
    body = (
      <div className={local.errorBlock}>
        <FocusedNotice error={results.error} />
        <div>
          <Button onClick={() => void results.refetch()}>{t('common.retry')}</Button>
        </div>
      </div>
    );
  } else if (results.isPending) {
    body = <LoadingState />;
  } else if (rows.length === 0) {
    body = <p className={styles.muted}>{t('platform.readers.none')}</p>;
  } else {
    body = (
      <>
        <DataTable
          ariaLabel={t('platform.readers.table')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
        />
        {rows.length >= MAX_RESULTS && (
          <p className={styles.muted}>{t('platform.readers.cap', { count: MAX_RESULTS })}</p>
        )}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('platform.readers.title')}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          flush();
        }}
      >
        <FilterBar>
          <SearchInput
            value={text}
            onChange={setText}
            label={t('platform.readers.search')}
            maxLength={MAX_SEARCH}
          />
        </FilterBar>
      </form>
      {/* The error is an alert already; keeping it out of the polite region announces it once. */}
      {errored ? body : <div aria-live="polite">{body}</div>}
    </div>
  );
}
