import { type FormEvent, useEffect, useRef } from 'react';
import { Form, useNavigation } from 'react-router';
import { Button } from '../ui';

/** What the buy action hands back to the purchase box; each is a `book.purchase.errors` key. */
export type BuyActionData = { purchaseError: 'unavailable' | 'notForSale' | 'generic' };

type Props = {
  /** The book page, whose action handles `intent=buy`. */
  action: string;
  /** Where a guest comes back to after signing in. */
  returnTo: string;
  /**
   * An idempotency key rendered by the server for this page, so two posts of the same form (a
   * double click before hydration, or the same page in two tabs) open one checkout.
   */
  idempotencyKey?: string;
  label: string;
  className?: string;
  buttonClassName?: string;
};

/**
 * "Bli librin": a form post to the book's buy action that is sent at most once at a time. A double
 * click would otherwise send two requests, which could open two checkouts before the session
 * remembers the first one.
 */
export function BuyForm({
  action,
  returnTo,
  idempotencyKey,
  label,
  className,
  buttonClassName,
}: Props) {
  const navigation = useNavigation();
  // The ref blocks a second click before React has re-rendered the button as busy.
  const sent = useRef(false);
  const busy = navigation.state !== 'idle' && navigation.formData?.get('intent') === 'buy';

  useEffect(() => {
    if (navigation.state === 'idle') sent.current = false;
  }, [navigation.state]);

  // A page restored from the back/forward cache keeps its old state: allow buying again.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) sent.current = false;
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (sent.current) event.preventDefault();
    sent.current = true;
  };

  return (
    <Form method="post" action={action} className={className} onSubmit={onSubmit}>
      <input type="hidden" name="intent" value="buy" />
      <input type="hidden" name="returnTo" value={returnTo} />
      {idempotencyKey ? <input type="hidden" name="idempotencyKey" value={idempotencyKey} /> : null}
      <Button type="submit" size="lg" loading={busy} className={buttonClassName}>
        {label}
      </Button>
    </Form>
  );
}
