import type { LoaderFunctionArgs } from 'react-router';
import { transactionStatus } from '../checkout/transaction.server';

/** GET /pagesa/:transactionId/status → `{ status }`, never cached. Polled by ConfirmPayment. */
export function loader({ request, params }: LoaderFunctionArgs): Promise<Response> {
  return transactionStatus(request, params.transactionId);
}

/** Only the poll itself asks: a page revalidation must not fire an extra status request. */
export function shouldRevalidate() {
  return false;
}
