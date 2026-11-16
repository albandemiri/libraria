import sourceSerifHref from '@fontsource-variable/source-serif-4/index.css?url';
import inter400Href from '@fontsource/inter/400.css?url';
import inter500Href from '@fontsource/inter/500.css?url';
import inter600Href from '@fontsource/inter/600.css?url';
import tokensHref from '@libraria/design/dist/tokens.css?url';
import { type ReactNode, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  type HeadersFunction,
  Links,
  type LinksFunction,
  type LoaderFunctionArgs,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from 'react-router';
import type { SessionUser } from './lib/types';
import { RouteErrorBoundary } from './layout/RouteErrorBoundary';
import { SiteShell } from './layout/SiteShell';
import { createI18n, DEFAULT_LANGUAGE, type Lang } from './i18n';
import { detectLanguage } from './server/i18n.server';
import { env } from './server/env.server';
import { getSession } from './server/session.server';
import globalHref from './styles/global.css?url';

export type RootLoaderData = {
  lang: Lang;
  user: SessionUser | null;
  portalUrl: string;
};

export async function loader({ request }: LoaderFunctionArgs): Promise<RootLoaderData> {
  const session = await getSession(request);
  return {
    lang: detectLanguage(request),
    user: session.get('user') ?? null,
    portalUrl: env.PORTAL_URL,
  };
}

/** Every document can depend on the session, so nothing may be stored by a shared cache. */
export const headers: HeadersFunction = () => ({
  'Cache-Control': 'private, max-age=0',
});

export const links: LinksFunction = () => [
  { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
  ...[sourceSerifHref, inter400Href, inter500Href, inter600Href, tokensHref, globalHref].map(
    (href) => ({ rel: 'stylesheet', href }),
  ),
];

export function Layout({ children }: { children: ReactNode }) {
  const data = useRouteLoaderData<RootLoaderData>('root');
  const lang = data?.lang ?? DEFAULT_LANGUAGE;
  // One instance per render tree and language: per request on the server, and the same
  // language on the client (from the loader data), so hydration matches.
  const i18n = useMemo(() => createI18n(lang), [lang]);

  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const data = useRouteLoaderData<RootLoaderData>('root');
  return (
    <SiteShell user={data?.user ?? null} portalUrl={data?.portalUrl}>
      <Outlet />
    </SiteShell>
  );
}

/**
 * Errors from routes without their own boundary, and the `*` catch-all's 404, render here, still
 * inside the site shell. The root loader may itself have failed, so the user falls back to a guest.
 */
export function ErrorBoundary() {
  const data = useRouteLoaderData<RootLoaderData>('root');
  return (
    <SiteShell user={data?.user ?? null} portalUrl={data?.portalUrl}>
      <RouteErrorBoundary />
    </SiteShell>
  );
}
