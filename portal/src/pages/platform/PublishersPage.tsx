import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { type AdminPublisher, useAdminPublishers, useCreatePublisher } from '../../api/admin';
import { currentLanguage } from '../../i18n';
import { countryName, formatPercentBps } from '../../lib/format';
import { useDebouncedUrlSearch, useUrlParams } from '../../lib/useUrlParams';
import {
  Button,
  type Column,
  DataTable,
  Dialog,
  FilterBar,
  LastUpdated,
  SearchInput,
  StatusBadge,
} from '../../ui';
import styles from '../Page.module.css';
import QueryView from '../QueryView';
import { adminErrorKey } from './adminErrors';
import local from './Platform.module.css';
import PublisherForm, { toApiCountry } from './PublisherForm';

const MAX_SEARCH = 200;

/** "Albania", or "Other" for the ZZ code, or a dash for a row from before countries existed. */
export function CountryText({ code }: { code: string | null }) {
  const { t } = useTranslation();
  if (code === null) return <>{t('common.none')}</>;
  return <>{code === 'ZZ' ? t('platform.country.other') : countryName(code, currentLanguage())}</>;
}

export function RateText({ bps }: { bps: number | null }) {
  const { t } = useTranslation();
  return bps === null ? (
    <StatusBadge tone="pending">{t('platform.publishers.noContract')}</StatusBadge>
  ) : (
    formatPercentBps(bps, currentLanguage())
  );
}

function NewPublisherDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreatePublisher();
  const formId = useId();
  const close = (next: boolean) => {
    if (!next) create.reset();
    onOpenChange(next);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={t('platform.publishers.newTitle')}
      actions={
        <>
          <Button onClick={() => close(false)}>{t('platform.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" loading={create.isPending}>
            {t('platform.form.create')}
          </Button>
        </>
      }
    >
      <PublisherForm
        formId={formId}
        showSubmit={false}
        errorKey={create.isError ? adminErrorKey(create.error) : null}
        onSubmit={(values) =>
          create.mutate(
            { ...values, country: toApiCountry(values.country) },
            {
              onSuccess: (publisher) => {
                close(false);
                // Next step of onboarding: its contract and its first invite.
                navigate(`/platform/publishers/${publisher.id}`);
              },
            },
          )
        }
      />
    </Dialog>
  );
}

export default function PublishersPage() {
  const { t } = useTranslation();
  const { params, update } = useUrlParams();
  const q = (params.get('q') ?? '').slice(0, MAX_SEARCH);
  const { text, setText, flush } = useDebouncedUrlSearch(q, update);
  const list = useAdminPublishers(q.trim());
  const [creating, setCreating] = useState(false);
  const rows = list.data ?? [];

  const columns: Array<Column<AdminPublisher>> = [
    {
      key: 'name',
      header: t('platform.publishers.name'),
      rowHeader: true,
      cell: (r) => (
        <Link to={`/platform/publishers/${r.id}`} className={local.cellLink}>
          {r.name}
        </Link>
      ),
    },
    {
      key: 'country',
      header: t('platform.publishers.country'),
      cell: (r) => <CountryText code={r.country} />,
    },
    {
      key: 'email',
      header: t('platform.publishers.email'),
      cell: (r) => <span className={local.wrapCell}>{r.contactEmail}</span>,
    },
    {
      key: 'rate',
      header: t('platform.publishers.rate'),
      align: 'end',
      cell: (r) => <RateText bps={r.currentRateBps} />,
    },
    {
      key: 'books',
      header: t('platform.publishers.books'),
      align: 'end',
      cell: (r) => String(r.bookCount),
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.sectionHead}>
        <h1 className={styles.title}>{t('platform.publishers.title')}</h1>
        <div className={local.rowActions}>
          <LastUpdated
            updatedAt={list.dataUpdatedAt}
            isFetching={list.isFetching}
            onRefresh={() => void list.refetch()}
          />
          <Button variant="primary" onClick={() => setCreating(true)}>
            {t('platform.publishers.new')}
          </Button>
        </div>
      </div>
      {/* The search box applies on typing (after a pause) or on Enter. */}
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
            label={t('platform.publishers.search')}
            maxLength={MAX_SEARCH}
          />
        </FilterBar>
      </form>
      <QueryView
        query={list}
        isEmpty={list.isSuccess && rows.length === 0}
        emptyBody={t('platform.publishers.emptySearch')}
      >
        <DataTable
          ariaLabel={t('platform.publishers.table')}
          columns={columns}
          rows={rows}
          rowKey={(r) => r.id}
        />
      </QueryView>
      {creating && <NewPublisherDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}
