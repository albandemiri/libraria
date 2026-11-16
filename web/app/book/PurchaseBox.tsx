import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useActionData } from 'react-router';
import { useLang } from '../books/useLang';
import { type BuyActionData, BuyForm } from '../checkout/BuyForm';
import { formatDate, formatPrice } from '../lib/format';
import type { BookDetail, Viewer } from '../lib/types';
import { Button, ProgressBar } from '../ui';
import styles from './PurchaseBox.module.css';
import type { PurchaseState } from './purchase-state';

type Props = {
  book: BookDetail;
  viewer: Viewer | null;
  state: PurchaseState;
  path: string;
  /** The page's idempotency key for "Bli librin" (see BuyForm). */
  checkoutKey?: string;
};

/**
 * The only part of the page that changes with the reader's relation to the book. Its `main` row
 * (price and primary action) is pinned to the bottom of the screen on phones.
 */
export function PurchaseBox({ book, viewer, state, path, checkoutKey }: Props) {
  const { t } = useTranslation();
  const lang = useLang();
  const day = (iso: string) => formatDate(iso, lang, 'day');

  const price = (
    <p className={styles.price}>
      {formatPrice(book.price.amountCents, book.price.currency, lang)}
      <small className={styles.vat}>{t('book.purchase.vat')}</small>
    </p>
  );
  // Set when "Bli librin" could not start a checkout (Discover's masthead posts here too).
  const purchaseError = useActionData<BuyActionData>()?.purchaseError;
  const buyForm = (label: string) => (
    <BuyForm
      action={path}
      returnTo={path}
      idempotencyKey={checkoutKey}
      label={label}
      className={styles.action}
      buttonClassName={styles.button}
    />
  );
  const linkButton = (to: string, label: string, variant: 'primary' | 'secondary' = 'primary') => (
    <div className={styles.action}>
      <Button asChild size="lg" variant={variant} className={styles.button}>
        <Link to={to}>{label}</Link>
      </Button>
    </div>
  );

  let top: ReactNode = null;
  let main: ReactNode = null;

  switch (state) {
    case 'guest_can_buy':
      main = (
        <>
          {price}
          {linkButton(`/hyr?returnTo=${encodeURIComponent(path)}`, t('book.purchase.buy'))}
        </>
      );
      break;
    case 'can_buy':
      main = (
        <>
          {price}
          {buyForm(t('book.purchase.buy'))}
        </>
      );
      break;
    case 'refunded': {
      const refund = viewer?.refund;
      top = refund ? (
        <p className={styles.note}>
          {t('book.purchase.refunded', {
            purchasedAt: day(refund.purchasedAt),
            refundedAt: day(refund.refundedAt),
          })}
        </p>
      ) : null;
      main = (
        <>
          {price}
          {buyForm(t('book.purchase.buyAgain'))}
        </>
      );
      break;
    }
    case 'owned': {
      const progress = viewer?.progress;
      const percent = progress?.percent ?? null;
      const caption = [
        percent !== null ? `${Math.round(percent)}%` : null,
        progress?.chapterTitle || null,
      ]
        .filter(Boolean)
        .join(' · ');
      top = (
        <>
          <p className={styles.owned}>
            {viewer?.acquiredAt
              ? t('book.purchase.ownedSince', { date: day(viewer.acquiredAt) })
              : t('book.owned')}
          </p>
          {percent !== null ? (
            <div className={styles.progress}>
              <ProgressBar value={percent} label={t('book.purchase.progressLabel')} />
            </div>
          ) : null}
          {caption ? <p className={styles.caption}>{caption}</p> : null}
        </>
      );
      main = linkButton(
        `/lexo/${book.id}`,
        caption ? t('book.purchase.continue') : t('book.purchase.readNow'),
      );
      break;
    }
    case 'pending':
      top = <p className={styles.status}>{t('book.purchase.pending')}</p>;
      main = viewer?.pendingTransactionId
        ? linkButton(
            `/pagesa/${encodeURIComponent(viewer.pendingTransactionId)}`,
            t('book.purchase.pendingLink'),
            'secondary',
          )
        : null;
      break;
    case 'owned_taken_down':
      top = <p className={styles.muted}>{t('book.purchase.takenDown')}</p>;
      break;
    case 'not_for_sale':
      top = <p className={styles.muted}>{t('book.notForSale')}</p>;
      break;
  }

  if (purchaseError) {
    top = (
      <>
        <p className={styles.error} role="alert">
          {t(`book.purchase.errors.${purchaseError}`)}
        </p>
        {top}
      </>
    );
  }

  return (
    <section className={styles.box} aria-label={t('book.purchase.label')} data-state={state}>
      {top ? <div className={styles.top}>{top}</div> : null}
      {main ? <div className={styles.main}>{main}</div> : null}
    </section>
  );
}
