import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import {
  type AdminPublisher,
  type PublisherInput,
  usePublisherBooks,
  useAdminPublisher,
  useUpdatePublisher,
} from '../../api/admin';
import { ApiError } from '../../api/client';
import BookStatusBadge from '../../components/BookStatusBadge';
import { usePublisherScope } from '../../layout/PublisherScope';
import { currentLanguage } from '../../i18n';
import { formatMoney } from '../../lib/format';
import { useUrlParams } from '../../lib/useUrlParams';
import {
  type Column,
  DataTable,
  EmptyState,
  ErrorState,
  LastUpdated,
  LoadingState,
  Tabs,
} from '../../ui';
import styles from '../Page.module.css';
import QueryView from '../QueryView';
import { adminErrorKey } from './adminErrors';
import ContractTab from './ContractTab';
import local from './Platform.module.css';
import PublisherForm, { fromApiCountry, toApiCountry } from './PublisherForm';
import TeamTab from './TeamTab';
import type { AdminBook } from '../../api/admin';

const TABS = ['details', 'team', 'contract', 'books'] as const;
type Tab = (typeof TABS)[number];

/** A hand-edited `?tab=` that names no tab reads as Details. */
const asTab = (value: string | null): Tab => TABS.find((tab) => tab === value) ?? 'details';

function DetailsTab({ publisher }: { publisher: AdminPublisher }) {
  const { t } = useTranslation();
  const update = useUpdatePublisher(publisher.id);
  const [nothing, setNothing] = useState(false);
  const initial = {
    name: publisher.name,
    contactEmail: publisher.contactEmail,
    country: fromApiCountry(publisher.country),
  };
  return (
    <div className={styles.page}>
      <PublisherForm
        // Fresh values after a save (or a refresh) start the form over from the server's.
        key={`${publisher.name}|${publisher.contactEmail}|${publisher.country}`}
        initial={initial}
        busy={update.isPending}
        saved={update.isSuccess && !nothing}
        message={nothing ? t('platform.form.nothing') : undefined}
        errorKey={update.isError ? adminErrorKey(update.error) : null}
        onSubmit={(values) => {
          // Only what changed goes to the server.
          const patch: Partial<PublisherInput> = {};
          if (values.name !== publisher.name) patch.name = values.name;
          if (values.contactEmail !== publisher.contactEmail) {
            patch.contactEmail = values.contactEmail;
          }
          const country = toApiCountry(values.country);
          if (country !== publisher.country) patch.country = country;
          setNothing(Object.keys(patch).length === 0);
          if (Object.keys(patch).length > 0) update.mutate(patch);
        }}
      />
    </div>
  );
}

function BooksTab({ publisherId }: { publisherId: string }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const { setPublisherId } = usePublisherScope();
  const books = usePublisherBooks(publisherId);
  const rows = books.data?.books ?? [];
  const total = books.data?.pagination.total ?? 0;

  // The publisher pages show the picked publisher, so opening a book switches to this one.
  const actAs = () => setPublisherId(publisherId);

  const columns: Array<Column<AdminBook>> = [
    {
      key: 'title',
      header: t('platform.books.title'),
      rowHeader: true,
      cell: (b) => (
        <Link to={`/catalog/${b.id}`} className={local.cellLink} onClick={actAs}>
          {b.title}
        </Link>
      ),
    },
    {
      key: 'status',
      header: t('status.label'),
      cell: (b) => <BookStatusBadge status={b.status} />,
    },
    {
      key: 'price',
      header: t('platform.books.price'),
      align: 'end',
      cell: (b) => formatMoney(b.price.amountCents, lang),
    },
    {
      key: 'copies',
      header: t('platform.books.copies'),
      align: 'end',
      cell: (b) => String(b.metrics.salesCount),
    },
    {
      key: 'gross',
      header: t('platform.books.gross'),
      align: 'end',
      cell: (b) => formatMoney(b.metrics.totalRevenueCents, lang),
    },
  ];

  return (
    <div className={styles.page}>
      <div>
        <Link to="/catalog" className={styles.link} onClick={actAs}>
          {t('platform.books.open')}
        </Link>
      </div>
      <QueryView
        query={books}
        isEmpty={books.isSuccess && rows.length === 0}
        emptyBody={t('platform.books.none')}
      >
        <DataTable
          ariaLabel={t('platform.books.table')}
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
        />
        {total > rows.length && (
          <p className={styles.muted}>{t('platform.books.more', { shown: rows.length, total })}</p>
        )}
      </QueryView>
    </div>
  );
}

/** One publisher: Details, Team (logins and invites), Contract and Books. */
export default function PublisherPage() {
  const { t } = useTranslation();
  const { publisherId = '' } = useParams();
  const { params, update } = useUrlParams();
  const tab = asTab(params.get('tab'));
  const detail = useAdminPublisher(publisherId);

  const error = detail.error;
  // A made-up or malformed id is "not found", not a failure to retry.
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return (
      <div className={styles.page}>
        <EmptyState
          title={t('platform.publisher.notFoundTitle')}
          body={t('platform.publisher.notFoundBody')}
          action={<Link to="/platform/publishers">{t('platform.publisher.all')}</Link>}
        />
      </div>
    );
  }
  if (detail.isError) return <ErrorState onRetry={() => void detail.refetch()} />;
  if (detail.isPending || !detail.data) return <LoadingState />;

  const { publisher, team, invites } = detail.data;

  return (
    <div className={styles.page}>
      <Link to="/platform/publishers" className={`${styles.link} ${local.back}`}>
        {t('platform.publisher.all')}
      </Link>
      <div className={styles.sectionHead}>
        <h1 className={styles.title}>{publisher.name}</h1>
        <LastUpdated
          updatedAt={detail.dataUpdatedAt}
          isFetching={detail.isFetching}
          onRefresh={() => void detail.refetch()}
        />
      </div>
      <Tabs
        label={t('platform.publisher.tabsLabel')}
        value={tab}
        onValueChange={(next) => update({ tab: next === 'details' ? undefined : next }, true)}
        items={[
          {
            value: 'details',
            label: t('platform.publisher.tabs.details'),
            panel: <DetailsTab publisher={publisher} />,
          },
          {
            value: 'team',
            label: t('platform.publisher.tabs.team'),
            panel: <TeamTab publisher={publisher} team={team} invites={invites} />,
          },
          {
            value: 'contract',
            label: t('platform.publisher.tabs.contract'),
            panel: <ContractTab publisherId={publisher.id} />,
          },
          {
            value: 'books',
            label: t('platform.publisher.tabs.books'),
            panel: <BooksTab publisherId={publisher.id} />,
          },
        ]}
      />
    </div>
  );
}
