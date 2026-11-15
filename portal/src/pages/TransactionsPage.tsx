import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSales } from '../api/reports';
import type { SalesLine } from '../api/types';
import Notice from '../components/Notice';
import SaleBreakdown from '../components/SaleBreakdown';
import SalesStatusBadge from '../components/SalesStatusBadge';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { countryName, formatDateTime, formatMoney, formatPercentBps } from '../lib/format';
import { Button, type Column, DataTable, EmptyState, LastUpdated, SidePanel } from '../ui';
import styles from './Ledger.module.css';
import page from './Page.module.css';
import QueryView from './QueryView';
import {
  LedgerControls,
  OpenButton,
  PAGE_SIZE,
  shortRef,
  useCsvExport,
  useLedgerFilters,
  useLedgerParams,
  useLedgerSearch,
  useOnChange,
} from './ledger';

function TransactionsContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const params = useLedgerParams();
  const { range, filters, filtered } = useLedgerFilters(params);
  const sales = useSales(filters, params.page, PAGE_SIZE);
  const search = useLedgerSearch(params);
  const csv = useCsvExport(filters, search);
  const [openId, setOpenId] = useState<string | null>(null);
  // The panel belongs to the page it was opened from.
  useOnChange(JSON.stringify([filters, params.page]), () => setOpenId(null));

  const list = sales.data?.lines ?? [];
  const pagination = sales.data?.pagination;
  const pageCount = pagination?.totalPages ?? 1;
  const selected = list.find((l) => l.itemId === openId);

  const money = (cents: number) => formatMoney(cents, lang);
  const num = (value: string) => <span className={styles.num}>{value}</span>;

  const columns: Array<Column<SalesLine>> = [
    { key: 'date', header: t('sales.date'), cell: (l) => num(formatDateTime(l.paidAt, lang)) },
    {
      key: 'ref',
      header: t('sales.reference'),
      cell: (l) => (
        <OpenButton
          label={t('sales.viewSale', { ref: shortRef(l.transactionId) })}
          onClick={() => setOpenId(l.itemId)}
        >
          {shortRef(l.transactionId)}
        </OpenButton>
      ),
    },
    {
      key: 'book',
      header: t('common.book'),
      cell: (l) => <span className={styles.titleCell}>{l.book.title}</span>,
    },
    { key: 'country', header: t('common.country'), cell: (l) => countryName(l.country, lang) },
    {
      key: 'status',
      header: t('status.label'),
      cell: (l) => <SalesStatusBadge status={l.status} />,
    },
    {
      key: 'price',
      header: t('sales.price'),
      align: 'end',
      cell: (l) => num(money(l.unitPriceCents)),
    },
    { key: 'vat', header: t('sales.vat'), align: 'end', cell: (l) => num(money(l.taxCents)) },
    {
      key: 'fee',
      header: t('sales.fee'),
      align: 'end',
      cell: (l) => (l.feeCents === null ? t('common.none') : num(money(l.feeCents))),
    },
    {
      key: 'pct',
      header: t('sales.commissionPct'),
      align: 'end',
      cell: (l) =>
        l.commissionRateBps === null
          ? t('common.none')
          : num(formatPercentBps(l.commissionRateBps, lang)),
    },
    {
      key: 'commission',
      header: t('sales.commission'),
      align: 'end',
      cell: (l) => (l.split === 'done' ? num(money(l.commissionCents)) : t('common.none')),
    },
    {
      key: 'earnings',
      header: t('sales.earnings'),
      align: 'end',
      cell: (l) =>
        l.split === 'done' ? (
          num(money(l.earningsCents))
        ) : (
          <span className={styles.muted}>
            {l.split === 'pending' ? t('sales.feePending') : t('sales.notSplit')}
          </span>
        ),
    },
    {
      key: 'refunded',
      header: t('sales.refunded'),
      align: 'end',
      cell: (l) => num(money(l.refundedCents)),
    },
  ];

  return (
    <div className={page.page}>
      <div className={styles.head}>
        <h1 className={page.title}>{t('nav.transactions')}</h1>
        <Button loading={csv.exporting} onClick={() => void csv.run()}>
          {t('sales.exportCsv')}
        </Button>
      </div>
      {csv.error && <Notice tone="error">{csv.error}</Notice>}

      <LedgerControls params={params} range={range} label={t('sales.filters')} search={search} />

      <QueryView query={sales}>
        {list.length === 0 && pagination && pagination.total > 0 ? (
          <EmptyState
            body={t('sales.pageOutOfRange')}
            action={
              <Button onClick={() => params.goToPage(pageCount)}>{t('sales.lastPage')}</Button>
            }
          />
        ) : list.length === 0 ? (
          <EmptyState body={filtered ? t('sales.empty') : t('sales.emptyPeriod')} />
        ) : (
          <DataTable
            ariaLabel={t('nav.transactions')}
            columns={columns}
            rows={list}
            rowKey={(l) => l.itemId}
            onRowClick={(l) => setOpenId(l.itemId)}
            pagination={
              pageCount > 1
                ? { page: params.page, pageCount, onPageChange: params.goToPage }
                : undefined
            }
          />
        )}
      </QueryView>
      <LastUpdated
        updatedAt={sales.dataUpdatedAt}
        isFetching={sales.isFetching}
        onRefresh={() => void sales.refetch()}
      />

      <SidePanel
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        title={t('sales.lineTitle', { ref: selected ? shortRef(selected.transactionId) : '' })}
      >
        {selected && <SaleBreakdown lines={[selected]} />}
      </SidePanel>
    </div>
  );
}

export default function TransactionsPage() {
  return (
    <ScopeGate>
      <TransactionsContent />
    </ScopeGate>
  );
}
