import { useTranslation } from 'react-i18next';
import { data, type LoaderFunctionArgs, type MetaFunction, useLoaderData } from 'react-router';
import { DiscoverSections } from '../discover/DiscoverSections';
import { IssueLine } from '../discover/IssueLine';
import { createI18n, type Lang } from '../i18n';
import type { DiscoverResponse } from '../lib/types';
import { apiFetch } from '../server/api.server';
import { detectLanguage } from '../server/i18n.server';
import { Button, ErrorState, VisuallyHidden } from '../ui';

type LoaderData = {
  discover: DiscoverResponse | null;
  lang: Lang;
  /** The render time (ISO), so relative dates match between the server and the hydrating client. */
  now: string;
  /** A fresh idempotency key per render for the masthead's "Bli librin" (see BuyForm). */
  checkoutKey?: string;
};

/** The Discover feed. If the API is down the page still renders, with a calm error state. */
export async function loader({ request }: LoaderFunctionArgs) {
  const lang = detectLanguage(request);
  const now = new Date().toISOString();
  try {
    const { data: discover, setCookie } = await apiFetch<DiscoverResponse>(request, '/discover', {
      auth: 'optional',
    });
    // An expired token was dropped from the session: pass the cleared cookie on.
    const init = setCookie ? { headers: { 'Set-Cookie': setCookie } } : undefined;
    return data<LoaderData>({ discover, lang, now, checkoutKey: crypto.randomUUID() }, init);
  } catch (error) {
    console.error('discover feed failed', error);
    return data<LoaderData>({ discover: null, lang, now }, { status: 503 });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data: loaderData }) => {
  const t = createI18n(loaderData?.lang ?? 'sq').t;
  const title = t('discover.metaTitle');
  const description = t('discover.metaDescription');
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: t('app.name') },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:locale', content: loaderData?.lang === 'en' ? 'en_US' : 'sq_AL' },
  ];
};

export default function Discover() {
  const { t } = useTranslation();
  const loaderData = useLoaderData<typeof loader>() as LoaderData | undefined;
  const discover = loaderData?.discover ?? null;

  return (
    <>
      <h1>
        <VisuallyHidden>{t('discover.title')}</VisuallyHidden>
      </h1>
      {loaderData && discover ? (
        <>
          <IssueLine issue={discover.issue} />
          <DiscoverSections
            sections={discover.sections}
            now={loaderData.now}
            checkoutKey={loaderData.checkoutKey}
          />
        </>
      ) : loaderData ? (
        <ErrorState
          title={t('discover.error.title')}
          description={t('discover.error.description')}
          action={
            // A full reload, so the loader runs again from scratch.
            <Button asChild variant="secondary">
              <a href="/">{t('discover.error.retry')}</a>
            </Button>
          }
        />
      ) : null}
    </>
  );
}
