// UNVERIFIED: no Paddle sandbox account yet (spec §6).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button, ErrorState } from '../ui';
import styles from './PaddleCheckout.module.css';

const PADDLE_JS = 'https://cdn.paddle.com/paddle/v2/paddle.js';

/** The slice of Paddle.js v2 used here. */
type PaddleEvent = { name?: string };
type PaddleGlobal = {
  Environment: { set(environment: 'sandbox'): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleEvent) => void }): void;
};

declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

export type PaddleCheckoutData = {
  clientToken: string | null;
  environment: 'sandbox' | 'production';
  /** Paddle's transaction id from the `_ptxn` query parameter. */
  ptxn: string | null;
  /** Our transaction for this checkout, when the session remembers it. */
  transactionId: string | null;
  /** The book being bought, for "back" when the reader closes the overlay. */
  bookId: string | null;
};

type Phase = 'opening' | 'loadFailed' | 'completed';

/**
 * Paddle's "default payment link" page: loads Paddle.js (on this page only) and lets it open the
 * overlay checkout. Per Paddle's documentation, Paddle.js opens the checkout for the `_ptxn` in
 * the URL by itself once initialised. When the checkout completes the reader goes to our
 * confirmation page, which waits for the signed webhook; closing it goes back to the book.
 */
export function PaddleCheckout({
  clientToken,
  environment,
  ptxn,
  transactionId,
  bookId,
}: PaddleCheckoutData) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('opening');
  const completed = useRef(false);

  useEffect(() => {
    if (!clientToken || !ptxn) return;
    const script = document.createElement('script');
    script.src = PADDLE_JS;
    script.async = true;
    script.onerror = () => setPhase('loadFailed');
    script.onload = () => {
      const paddle = window.Paddle;
      if (!paddle) {
        setPhase('loadFailed');
        return;
      }
      if (environment === 'sandbox') paddle.Environment.set('sandbox');
      paddle.Initialize({
        token: clientToken,
        eventCallback: (event) => {
          if (event.name === 'checkout.completed') {
            completed.current = true;
            if (transactionId) navigate(`/pagesa/${encodeURIComponent(transactionId)}`);
            else setPhase('completed');
          } else if (event.name === 'checkout.closed' && !completed.current) {
            navigate(bookId ? `/libri/${encodeURIComponent(bookId)}` : '/eksploro');
          }
        },
      });
    };
    document.head.appendChild(script);
    return () => script.remove();
  }, [clientToken, environment, ptxn, transactionId, bookId, navigate]);

  const back = (
    <Button asChild variant="secondary">
      <a href="/eksploro">{t('checkout.paddle.back')}</a>
    </Button>
  );

  let error: string | null = null;
  if (!clientToken) error = t('book.purchase.errors.unavailable');
  else if (!ptxn) error = t('checkout.paddle.missing');
  else if (phase === 'loadFailed') error = t('checkout.paddle.loadFailed');

  return (
    <div className={styles.page}>
      {error ? (
        <ErrorState title={t('checkout.paddle.errorTitle')} description={error} action={back} />
      ) : (
        <p className={styles.status} role="status">
          {phase === 'completed' ? t('checkout.stillProcessing') : t('checkout.paddle.opening')}
        </p>
      )}
      {/* Completed, but not one of this session's checkouts: somewhere to go from here. */}
      {!error && phase === 'completed' ? (
        <div className={styles.onward}>
          <Button asChild>
            {bookId ? (
              <Link to={`/libri/${encodeURIComponent(bookId)}`}>{t('checkout.paddle.toBook')}</Link>
            ) : (
              <Link to="/eksploro">{t('checkout.paddle.back')}</Link>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
