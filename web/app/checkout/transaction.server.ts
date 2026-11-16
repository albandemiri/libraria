import { data, redirect } from 'react-router';
import { isUuid } from '../explore/params';
import type { Receipt } from '../lib/types';
import { ApiError, apiFetch } from '../server/api.server';
import { env } from '../server/env.server';
import { commitSession, getSession } from '../server/session.server';

export type CheckoutStatusData = {
  transaction: Receipt;
  /** Show the development payment panel (simulated provider, transaction still pending). */
  simulated: boolean;
};

const notFound = () => new Response('Not Found', { status: 404 });

/** The reader's own transaction; anyone else's (or an unknown id) is a 404 from the API. */
async function fetchTransaction(request: Request, id: string | undefined): Promise<Receipt> {
  if (!isUuid(id)) throw notFound();
  try {
    const { data: body } = await apiFetch<{ transaction: Receipt }>(
      request,
      `/transactions/${encodeURIComponent(id)}`,
      { auth: 'required' },
    );
    return body.transaction;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw notFound();
    if (error instanceof ApiError) {
      console.error('transaction lookup failed', error);
      throw new Response('Service Unavailable', { status: 503 });
    }
    throw error;
  }
}

/**
 * `/pagesa/:transactionId`. Once the transaction has left `pending`, its books' stored checkouts
 * are dropped, so the next "Bli librin" starts afresh.
 */
export async function loadCheckoutStatus(request: Request, id: string | undefined) {
  const transaction = await fetchTransaction(request, id);
  const payload: CheckoutStatusData = {
    transaction,
    simulated: env.PAYMENTS_MODE === 'simulated' && transaction.status === 'pending',
  };
  if (transaction.status === 'pending') return data(payload);

  const session = await getSession(request);
  const checkouts = session.get('checkouts') ?? {};
  const remaining = Object.fromEntries(
    Object.entries(checkouts).filter(([, entry]) => entry.transactionId !== transaction.id),
  );
  if (Object.keys(remaining).length === Object.keys(checkouts).length) return data(payload);

  if (Object.keys(remaining).length > 0) session.set('checkouts', remaining);
  else session.unset('checkouts');
  return data(payload, { headers: { 'Set-Cookie': await commitSession(session) } });
}

const SANDBOX_EVENTS = {
  pay: 'payment_succeeded',
  fail: 'payment_failed',
  cancel: 'checkout_cancelled',
} as const;

/**
 * DEVELOPMENT ONLY: the simulated panel's buttons. Plays the provider's part through the API's
 * sandbox, which signs the event and runs the real webhook path, then shows the page again.
 */
export async function simulatePayment(request: Request, id: string | undefined, form: FormData) {
  if (env.PAYMENTS_MODE !== 'simulated' || !isUuid(id)) throw notFound();
  const event = form.get('event');
  if (typeof event !== 'string' || !Object.hasOwn(SANDBOX_EVENTS, event)) {
    throw new Response('Bad Request', { status: 400 });
  }
  try {
    await apiFetch(request, `/sandbox/transactions/${encodeURIComponent(id)}/events`, {
      method: 'POST',
      body: { kind: SANDBOX_EVENTS[event as keyof typeof SANDBOX_EVENTS] },
      auth: 'required',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw notFound();
    throw error;
  }
  return redirect(`/pagesa/${encodeURIComponent(id)}`);
}

const statusJson = (status: string | null, httpStatus = 200) =>
  Response.json(
    { status },
    { status: httpStatus, headers: { 'Cache-Control': 'private, no-store' } },
  );

/**
 * `GET /pagesa/:transactionId/status`, polled by the confirmation page. A malformed, unknown or
 * someone else's id is a 404. `status: null` with a 200 means "could not tell this time" and the
 * page keeps polling. A signed-out reader is sent to sign-in, coming back to the confirmation page
 * rather than to this JSON.
 */
export async function transactionStatus(request: Request, id: string | undefined) {
  try {
    const transaction = await fetchTransaction(request, id);
    return statusJson(transaction.status);
  } catch (thrown) {
    if (thrown instanceof Response && thrown.status === 404) return statusJson(null, 404);
    if (thrown instanceof Response && thrown.status >= 300 && thrown.status < 400) {
      const headers = new Headers(thrown.headers);
      headers.set('Location', `/hyr?returnTo=${encodeURIComponent(`/pagesa/${id ?? ''}`)}`);
      throw new Response(null, { status: thrown.status, headers });
    }
    if (!(thrown instanceof Response)) console.error('transaction status failed', thrown);
    return statusJson(null);
  }
}
