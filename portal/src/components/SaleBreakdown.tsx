import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type { SalesLine } from '../api/types';
import { currentLanguage } from '../i18n';
import { countryName, formatDateTime, formatMoney, formatPercentBps } from '../lib/format';
import styles from '../pages/Ledger.module.css';
import SalesStatusBadge from './SalesStatusBadge';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.dlRow}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LineBreakdown({ line }: { line: SalesLine }) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const id = useId();
  const money = (cents: number) => formatMoney(cents, lang);
  const none = t('common.none');
  // Split figures exist only once the line is split; until then the API's zeros are placeholders,
  // so they are not shown as money.
  const split = line.split === 'done';
  const splitMoney = (cents: number) => (split ? money(cents) : none);
  return (
    <section className={styles.line} aria-labelledby={id}>
      <div className={styles.lineHead}>
        <h3 id={id} className={styles.lineTitle}>
          {line.book.title}
        </h3>
        <SalesStatusBadge status={line.status} />
      </div>
      <dl className={styles.dl}>
        <Row label={t('sales.transaction')} value={line.transactionId} />
        <Row label={t('common.country')} value={countryName(line.country, lang)} />
        <Row label={t('sales.paidAt')} value={formatDateTime(line.paidAt, lang)} />
        <Row
          label={t('sales.refundedAt')}
          value={line.refundedAt ? formatDateTime(line.refundedAt, lang) : none}
        />
        <Row label={t('sales.price')} value={money(line.unitPriceCents)} />
        <Row label={t('sales.vat')} value={money(line.taxCents)} />
        <Row
          label={t('sales.paymentFee')}
          value={line.feeCents === null ? none : money(line.feeCents)}
        />
        <Row
          label={t('sales.commissionPct')}
          value={
            line.commissionRateBps !== null ? formatPercentBps(line.commissionRateBps, lang) : none
          }
        />
        <Row label={t('metrics.commissionAtSale')} value={splitMoney(line.commissionAtSaleCents)} />
        <Row
          label={t('metrics.commissionReversed')}
          value={splitMoney(line.commissionReversedCents)}
        />
        <Row label={t('sales.earningsAtSale')} value={splitMoney(line.earningsAtSaleCents)} />
        <Row label={t('metrics.earningsReversed')} value={splitMoney(line.earningsReversedCents)} />
        <Row label={t('sales.earnings')} value={splitMoney(line.earningsCents)} />
        <Row label={t('sales.refunded')} value={money(line.refundedCents)} />
        <Row
          label={t('sales.splitState')}
          value={
            line.split === 'done'
              ? t('sales.split.done')
              : line.split === 'pending'
                ? t('sales.feePending')
                : t('sales.notSplit')
          }
        />
      </dl>
    </section>
  );
}

/** The full per-line breakdown of a sale, as the API reports it. No order-level roll-up. */
export default function SaleBreakdown({ lines }: { lines: SalesLine[] }) {
  return (
    <div className={styles.breakdown}>
      {lines.map((line) => (
        <LineBreakdown key={line.itemId} line={line} />
      ))}
    </div>
  );
}
