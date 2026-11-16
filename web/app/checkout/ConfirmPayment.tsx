import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useFetcher, useRevalidator } from 'react-router';
import { BookCover } from '../books/BookCover';
import { useLang } from '../books/useLang';
import { bookHref, formatPrice } from '../lib/format';
import type { Receipt } from '../lib/types';
import { Button } from '../ui';
import styles from './ConfirmPayment.module.css';
import { SimulatedPanel } from './SimulatedPanel';

/** When to ask again, in milliseconds since the page opened: 1, 2, 3 and 5 s, then every 5 s to 60 s. */
export const POLL_AT_MS: readonly number[] = [
  1_000,
  2_000,
  3_000,
  ...Array.from({ length: 12 }, (_, i) => 5_000 * (i + 1)),
];

/**
 * Polls `/pagesa/:id/status` on the schedule above while `active`. Once the status leaves
 * `pending` it stops and reloads the page's data (whose loader also forgets the stored checkout).
 * Returns true when the last poll is back and the transaction is still pending.
 */
function useStatusPolling(id: string, active: boolean): boolean {
  const fetcher = useFetcher<{ status: string | null }>();
  const { load } = fetcher;
  const { revalidate } = useRevalidator();
  const [polls, setPolls] = useState(0);
  const polled = fetcher.data?.status;
  const settled = polled != null && polled !== 'pending';

  useEffect(() => {
    if (!active || settled || polls >= POLL_AT_MS.length) return;
    const wait = (POLL_AT_MS[polls] ?? 0) - (POLL_AT_MS[polls - 1] ?? 0);
    const timer = setTimeout(() => {
      load(`/pagesa/${encodeURIComponent(id)}/status`);
      setPolls(polls + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [active, settled, polls, id, load]);

  useEffect(() => {
    if (settled) revalidate();
  }, [settled, revalidate]);

  return active && !settled && polls >= POLL_AT_MS.length && fetcher.state === 'idle';
}

const ENDED = new Set(['failed', 'cancelled', 'expired']);

type Props = { transaction: Receipt; simulated: boolean };

/**
 * `/pagesa/:transactionId`: "Po konfirmojmë pagesën…" while pending, then the outcome. Ownership is
 * whatever the API says; this page only reports it.
 */
export function ConfirmPayment({ transaction, simulated }: Props) {
  const { t } = useTranslation();
  const lang = useLang();
  const { status } = transaction;
  const pending = status === 'pending';
  const gaveUp = useStatusPolling(transaction.id, pending);
  const first = transaction.items[0]?.book;
  const bookPath = first ? bookHref(first) : '/eksploro';

  let title: string;
  let text: string | null = null;
  let action: { to: string; label: string; external?: boolean } | null = null;
  if (pending) {
    title = t('checkout.confirming');
    // Paddle: the reader may have closed the overlay; its checkout is still open to them.
    if (transaction.provider === 'paddle' && transaction.checkoutUrl) {
      action = { to: transaction.checkoutUrl, label: t('checkout.continue'), external: true };
    }
  } else if (status === 'paid') {
    title = t('checkout.paid.title');
    action = { to: bookPath, label: t('checkout.paid.open') };
  } else if (ENDED.has(status)) {
    title = t(`checkout.${status}.title`);
    text = t(`checkout.${status}.text`);
    action = { to: bookPath, label: t('checkout.retry') };
  } else {
    // Refunded or disputed later on: the book page tells the current story.
    title = t('checkout.closed.title');
    text = t('checkout.closed.text');
    action = { to: bookPath, label: t('checkout.paid.open') };
  }

  return (
    <section className={styles.page} data-status={status}>
      <p className={styles.kicker}>{t('checkout.kicker')}</p>
      <h1 className={styles.title}>
        {pending && !gaveUp ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {title}
      </h1>
      {/* Announced when the wait runs out; empty (but present) before that. */}
      {pending ? (
        <p className={styles.text} role="status">
          {gaveUp ? t('checkout.stillProcessing') : null}
        </p>
      ) : null}
      {text ? <p className={styles.text}>{text}</p> : null}
      {action ? (
        <Button asChild size="lg">
          {action.external ? (
            <a href={action.to}>{action.label}</a>
          ) : (
            <Link to={action.to}>{action.label}</Link>
          )}
        </Button>
      ) : null}

      <div className={styles.summary}>
        <ul className={styles.items}>
          {transaction.items.map(({ book }) => (
            <li key={book.id} className={styles.item}>
              <div className={styles.cover}>
                <BookCover
                  book={book}
                  size="thumb"
                  priority
                  alt={t('book.coverAlt', { title: book.title })}
                />
              </div>
              <div>
                <p className={styles.bookTitle}>{book.title}</p>
                <p className={styles.author}>{book.author}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className={styles.total}>
          {t('checkout.total')}{' '}
          <b>{formatPrice(transaction.total.amountCents, transaction.total.currency, lang)}</b>
        </p>
      </div>

      {simulated && pending ? <SimulatedPanel /> : null}
    </section>
  );
}
