// UNVERIFIED: no Paddle sandbox account yet (spec §6).
import type { LoaderFunctionArgs, MetaFunction } from 'react-router';
import { useLoaderData } from 'react-router';
import { PaddleCheckout, type PaddleCheckoutData } from '../checkout/PaddleCheckout';
import { createI18n, isLang } from '../i18n';
import type { Receipt } from '../lib/types';
import { apiFetch } from '../server/api.server';
import { env } from '../server/env.server';
import { getSession } from '../server/session.server';

/** The `_ptxn` of a Paddle checkout URL, if it has one. */
function ptxnOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams.get('_ptxn');
  } catch {
    return null;
  }
}

/**
 * Which of the session's checkouts this Paddle transaction belongs to: the receipt of each stored
 * checkout carries its Paddle checkout URL, whose `_ptxn` must match.
 */
async function findCheckout(request: Request, ptxn: string) {
  const session = await getSession(request);
  for (const [bookId, entry] of Object.entries(session.get('checkouts') ?? {})) {
    try {
      const { data } = await apiFetch<{ transaction: Receipt }>(
        request,
        `/transactions/${encodeURIComponent(entry.transactionId)}`,
        { auth: 'optional' },
      );
      if (ptxnOf(data.transaction.checkoutUrl) === ptxn) {
        return { transactionId: data.transaction.id, bookId };
      }
    } catch {
      // An unreadable entry is just not this checkout.
    }
  }
  return { transactionId: null, bookId: null };
}

/** `/pagesa?_ptxn=…`: Paddle's default payment link, which opens the overlay checkout. */
export async function loader({ request }: LoaderFunctionArgs): Promise<PaddleCheckoutData> {
  const ptxn = new URL(request.url).searchParams.get('_ptxn');
  const clientToken = env.PADDLE_CLIENT_TOKEN ?? null;
  const found =
    ptxn && clientToken ? await findCheckout(request, ptxn) : { transactionId: null, bookId: null };
  return { clientToken, environment: env.PADDLE_ENVIRONMENT, ptxn, ...found };
}

export const meta: MetaFunction = ({ matches }) => {
  const rootLang = (matches.find((m) => m?.id === 'root')?.data as { lang?: unknown } | undefined)
    ?.lang;
  const { t } = createI18n(isLang(rootLang) ? rootLang : 'sq');
  return [{ title: t('checkout.metaTitle') }, { name: 'robots', content: 'noindex' }];
};

export default function CheckoutStart() {
  return <PaddleCheckout {...(useLoaderData() as PaddleCheckoutData)} />;
}
