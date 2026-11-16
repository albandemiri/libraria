import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { ConfirmPayment } from '../checkout/ConfirmPayment';
import {
  type CheckoutStatusData,
  loadCheckoutStatus,
  simulatePayment,
} from '../checkout/transaction.server';
import { createI18n, isLang } from '../i18n';
import { RouteErrorBoundary } from '../layout/RouteErrorBoundary';
import { assertSameOrigin } from '../server/security.server';

/** `/pagesa/:transactionId`: the reader's own transaction, after the provider hands back. */
export function loader({ request, params }: LoaderFunctionArgs) {
  return loadCheckoutStatus(request, params.transactionId);
}

/** The development panel's "Paguaj", "Dështo" and "Anulo" (simulated payments only). */
export async function action({ request, params }: ActionFunctionArgs) {
  assertSameOrigin(request);
  return simulatePayment(request, params.transactionId, await request.formData());
}

export const meta: MetaFunction = ({ matches }) => {
  const rootLang = (matches.find((m) => m?.id === 'root')?.data as { lang?: unknown } | undefined)
    ?.lang;
  const { t } = createI18n(isLang(rootLang) ? rootLang : 'sq');
  return [{ title: t('checkout.metaTitle') }, { name: 'robots', content: 'noindex' }];
};

export const ErrorBoundary = RouteErrorBoundary;

export default function CheckoutStatus() {
  const { transaction, simulated } = useLoaderData() as CheckoutStatusData;
  // Keyed by status, so polling restarts cleanly if the page ever shows a new pending state.
  return (
    <ConfirmPayment
      key={`${transaction.id}:${transaction.status}`}
      transaction={transaction}
      simulated={simulated}
    />
  );
}
