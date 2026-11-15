import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useOrders } from '../api/reports';
import type { SalesLine } from '../api/types';
import Notice from '../components/Notice';
import SaleBreakdown from '../components/SaleBreakdown';
import SalesStatusBadge from '../components/SalesStatusBadge';
import ScopeGate from '../components/ScopeGate';
import { currentLanguage } from '../i18n';
import { formatDateTime, formatMoney } from '../lib/format';
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

type Order = { transactionId: string; paidAt: string; lines: SalesLine[] };

function SalesOrdersContent() {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const params = useLedgerParams();
  const { range, filters, filtered } = useLedgerFilters(params);
  const orders = useOrders(filters, params.page, PAGE_SIZE);
  const search = useLedgerSearch(params);
  const csv = useCsvExport(filters, search);
  const [openId, setOpenId] = useState<string | null>(null);
  // The panel belongs to the page it was opened from.
  useOnChange(JSON.stringify([filters, params.page]), () => setOpenId(null));

  const list = orders.data?.orders ?? [];
  const pagination = orders.data?.pagination;
  const pageCount = pagination?.totalPages ?? 1;
  const selected = list.find((o) => o.transactionId === openId);

  const money = (cents: number) => formatMoney(cents, lang);
  // An order's figures are listed per line, exactly as the API sends them: the browser does no
  // money arithmetic. Every item names its book for screen readers.
  const stack = (o: Order, item: (l: SalesLine) => ReactNode, align?: 'end') => (
    <span className={styles.stack} data-align={align}>
      {o.lines.map((l) => (
        <span key={l.itemId} className={styles.num}>
          <span className="ui-sr-only">{l.book.title}: </span>
          {item(l)}
        </span>
      ))}
    </span>
  );

  const columns: Array<Column<Order>> = [
    {
      key: 'date',
      header: t('sales.date'),
      cell: (o) => <span className={styles.num}>{formatDateTime(o.paidAt, lang)}</span>,
    },
    {
      key: 'ref',
      header: t('sales.reference'),
      cell: (o) => (
        <OpenButton
          label={t('sales.viewOrder', { ref: shortRef(o.transactionId) })}
          onClick={() => setOpenId(o.transactionId)}
        >
          {shortRef(o.transactionId)}
        </OpenButton>
      ),
    },
    {
      key: 'books',
      header: t('sales.books'),
      cell: (o) => (
        <span className={styles.stack}>
          {o.lines.map((l) => (
            <span key={l.itemId} className={styles.clip} title={l.book.title}>
              {l.book.title}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('status.label'),
      cell: (o) => stack(o, (l) => <SalesStatusBadge status={l.status} />),
    },
    {
      key: 'gross',
      header: t('sales.gross'),
      align: 'end',
      cell: (o) => stack(o, (l) => money(l.unitPriceCents), 'end'),
    },
    {
      key: 'earnings',
      header: t('sales.earnings'),
      align: 'end',
      cell: (o) =>
        stack(
          o,
          (l) =>
            l.split === 'done'
              ? money(l.earningsCents)
              : l.split === 'pending'
                ? t('sales.feePending')
                : t('sales.notSplit'),
          'end',
        ),
    },
  ];

  return (
    <div className={page.page}>
      <div className={styles.head}>
        <h1 className={page.title}>{t('nav.sales')}</h1>
        <div className={styles.headActions}>
          <Button loading={csv.exporting} onClick={() => void csv.run()}>
            {t('sales.exportCsv')}
          </Button>
          <p className={styles.hint}>{t('sales.exportHint')}</p>
        </div>
      </div>
      {csv.error && <Notice tone="error">{csv.error}</Notice>}

      <LedgerControls params={params} range={range} label={t('sales.filters')} search={search} />

      <QueryView query={orders}>
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
            ariaLabel={t('nav.sales')}
            columns={columns}
            rows={list}
            rowKey={(o) => o.transactionId}
            onRowClick={(o) => setOpenId(o.transactionId)}
            pagination={
              pageCount > 1
                ? { page: params.page, pageCount, onPageChange: params.goToPage }
                : undefined
            }
          />
        )}
      </QueryView>
      <LastUpdated
        updatedAt={orders.dataUpdatedAt}
        isFetching={orders.isFetching}
        onRefresh={() => void orders.refetch()}
      />

      <SidePanel
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        title={t('sales.orderTitle', { ref: selected ? shortRef(selected.transactionId) : '' })}
      >
        {selected && <SaleBreakdown lines={selected.lines} />}
      </SidePanel>
    </div>
  );
}

export default function SalesOrdersPage() {
  return (
    <ScopeGate>
      <SalesOrdersContent />
    </ScopeGate>
  );
}
