import { data, redirect } from 'react-router';
import { safeReturnTo } from '../lib/return-to';
import type { CheckoutSession, Receipt } from '../lib/types';
import { ApiError, apiFetch } from '../server/api.server';
import { type AppSession, commitSession, getSession } from '../server/session.server';
import type { BuyActionData } from './BuyForm';

/** A key the page rendered (see BuyForm); the API accepts 8 to 100 characters. */
const FORM_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/**
 * The idempotency key for this book's checkout. The stored one while its transaction is still
 * pending (a double click, or going back and buying again, reopens the same checkout); else the
 * key the page rendered into the form, so two posts of one page (a double click before hydration,
 * two tabs) agree without the session; else a fresh one.
 */
async function idempotencyKeyFor(
  request: Request,
  session: AppSession,
  bookId: string,
  form: FormData,
): Promise<string> {
  const checkouts = session.get('checkouts');
  const stored = checkouts && Object.hasOwn(checkouts, bookId) ? checkouts[bookId] : undefined;
  if (stored) {
    try {
      const { data: body } = await apiFetch<{ transaction: Receipt }>(
        request,
        `/transactions/${encodeURIComponent(stored.transactionId)}`,
        { auth: 'required' },
      );
      if (body.transaction.status === 'pending') return stored.idempotencyKey;
    } catch (error) {
      // A transaction we cannot see any more is simply not reused; anything else is a real failure,
      // and guessing "ended" there could open a second checkout.
      if (!(error instanceof ApiError) || error.status >= 500) throw error;
    }
  }
  const field = form.get('idempotencyKey');
  return typeof field === 'string' && FORM_KEY.test(field) ? field : crypto.randomUUID();
}

function withCheckout(
  session: AppSession,
  bookId: string,
  entry: { transactionId: string; idempotencyKey: string } | null,
) {
  const checkouts = { ...(session.get('checkouts') ?? {}) };
  if (entry) checkouts[bookId] = entry;
  else delete checkouts[bookId];
  if (Object.keys(checkouts).length > 0) session.set('checkouts', checkouts);
  else session.unset('checkouts');
}

/**
 * The book page's `intent=buy`. A guest goes to sign-in (back to the form's `returnTo` when it is
 * safe, else the book). A reader gets a checkout: Paddle's URL when the provider has one, otherwise
 * our own `/pagesa/:transactionId`. Nothing is granted here: only the signed webhook does that.
 */
export async function buyBook(request: Request, bookId: string, form: FormData) {
  const bookPath = new URL(request.url).pathname;
  const session = await getSession(request);

  if (!session.get('token')) {
    const field = form.get('returnTo');
    const returnTo = typeof field === 'string' && safeReturnTo(field) === field ? field : bookPath;
    throw redirect(`/hyr?returnTo=${encodeURIComponent(returnTo)}`);
  }

  let idempotencyKey = await idempotencyKeyFor(request, session, bookId, form);
  const commit = async () => ({ 'Set-Cookie': await commitSession(session) });
  const failure = async (purchaseError: BuyActionData['purchaseError']) =>
    data<BuyActionData>({ purchaseError }, { headers: await commit() });

  const startCheckout = async (key: string) => {
    const { data: body } = await apiFetch<CheckoutSession>(request, '/checkout-sessions', {
      method: 'POST',
      body: { bookIds: [bookId], idempotencyKey: key },
      auth: 'required',
    });
    return body;
  };

  try {
    let body = await startCheckout(idempotencyKey);
    if (body.transaction.status !== 'pending') {
      // A stale page (say, restored from history) sent the key of a checkout that has ended:
      // the API returned that old transaction. Start a new one instead, once.
      idempotencyKey = crypto.randomUUID();
      body = await startCheckout(idempotencyKey);
    }
    withCheckout(session, bookId, { transactionId: body.transaction.id, idempotencyKey });
    const to = body.checkout.url ?? `/pagesa/${encodeURIComponent(body.transaction.id)}`;
    return redirect(to, { headers: await commit() });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    switch (error.code) {
      case 'ALREADY_OWNED':
        withCheckout(session, bookId, null);
        return redirect(bookPath, { headers: await commit() });
      case 'PAYMENTS_UNAVAILABLE':
        return failure('unavailable');
      case 'BOOK_NOT_FOR_SALE':
      case 'NOT_FOUND':
        return failure('notForSale');
    }
    if (error.status < 500) return failure('generic');
    throw error;
  }
}
