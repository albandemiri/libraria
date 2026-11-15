import { useTranslation } from 'react-i18next';
import { useContract } from '../api/books';
import type { CommissionRate } from '../api/types';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { formatDate, formatPercentBps } from '../lib/format';
import { type Column, DataTable, EmptyState, LastUpdated, StatusBadge, type Tone } from '../ui';
import orgStyles from './Org.module.css';
import styles from './Page.module.css';
import QueryView from './QueryView';
import Section from './Section';

const TONE: Record<CommissionRate['status'], Tone> = {
  active: 'positive',
  scheduled: 'pending',
  superseded: 'neutral',
};

function ContractStatus({ status }: { status: CommissionRate['status'] }) {
  const { t } = useTranslation();
  return <StatusBadge tone={TONE[status]}>{t(`contract.status.${status}`)}</StatusBadge>;
}

function ContractsContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const contract = useContract();
  const current = contract.data?.current ?? null;
  const history = contract.data?.history ?? [];

  const columns: Array<Column<CommissionRate>> = [
    {
      key: 'from',
      header: t('contract.effectiveFrom'),
      rowHeader: true,
      cell: (r) => formatDate(r.effectiveFrom, lang),
    },
    {
      key: 'rate',
      header: t('contract.rate'),
      align: 'end',
      cell: (r) => formatPercentBps(r.rateBps, lang),
    },
    {
      key: 'reference',
      header: t('contract.reference'),
      cell: (r) => r.contractReference ?? t('common.none'),
    },
    { key: 'status', header: t('status.label'), cell: (r) => <ContractStatus status={r.status} /> },
  ];

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('nav.contracts')}</h1>
      <QueryView query={contract}>
        <Section
          title={t('contract.current')}
          actions={
            <LastUpdated
              updatedAt={contract.dataUpdatedAt}
              isFetching={contract.isFetching}
              onRefresh={() => void contract.refetch()}
            />
          }
        >
          {current ? (
            <dl className={orgStyles.current}>
              <div>
                <dt className={styles.heroLabel}>{t('contract.rate')}</dt>
                <dd className={orgStyles.rate}>{formatPercentBps(current.rateBps, lang)}</dd>
              </div>
              <div>
                <dt className={styles.heroLabel}>{t('contract.since')}</dt>
                <dd className={orgStyles.value}>{formatDate(current.effectiveFrom, lang)}</dd>
              </div>
              <div>
                <dt className={styles.heroLabel}>{t('contract.reference')}</dt>
                <dd className={orgStyles.value}>{current.contractReference ?? t('common.none')}</dd>
              </div>
              <div>
                <dt className={styles.heroLabel}>{t('status.label')}</dt>
                <dd className={orgStyles.value}>
                  <ContractStatus status={current.status} />
                </dd>
              </div>
            </dl>
          ) : (
            <EmptyState title={t('contract.noneTitle')} body={t('contract.none')} />
          )}
        </Section>
        {history.length > 0 && (
          <Section title={t('contract.history')}>
            <DataTable
              columns={columns}
              rows={history}
              rowKey={(r) => r.id}
              ariaLabel={t('contract.historyTable')}
            />
          </Section>
        )}
      </QueryView>
    </div>
  );
}

export default function ContractsPage() {
  return (
    <ScopeGate>
      <ContractsContent />
    </ScopeGate>
  );
}
