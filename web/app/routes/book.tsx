import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from 'react-router';
import { loadBook } from '../book/book.server';
import { BookPage, type BookPageData } from '../book/BookPage';
import { bookMeta } from '../book/seo';
import { buyBook } from '../checkout/buy.server';
import { isUuid } from '../explore/params';
import { createI18n, isLang } from '../i18n';
import { RouteErrorBoundary } from '../layout/RouteErrorBoundary';
import { assertSameOrigin } from '../server/security.server';

/** `/libri/:id/:slug?`: a missing or wrong slug is a 301 to the canonical URL. */
export function loader({ request, params }: LoaderFunctionArgs) {
  return loadBook(request, params);
}

/** The purchase box's "Bli librin" (also posted from Discover's masthead with `returnTo=/`). */
export async function action({ request, params }: ActionFunctionArgs) {
  assertSameOrigin(request);
  const form = await request.formData();
  if (form.get('intent') !== 'buy') throw new Response('Bad Request', { status: 400 });
  if (!isUuid(params.id)) throw new Response('Not Found', { status: 404 });
  return buyBook(request, params.id, form);
}

export const meta: MetaFunction<typeof loader> = ({ data, error, matches }) => {
  const page = data as BookPageData | undefined;
  if (!page || error) {
    // The 404 page inside the shell: its language comes from the root loader.
    const rootLang = (matches.find((m) => m?.id === 'root')?.data as { lang?: unknown } | undefined)
      ?.lang;
    const { t } = createI18n(isLang(rootLang) ? rootLang : 'sq');
    return [{ title: t('explore.metaTitle', { title: t('notFound.title') }) }];
  }
  return bookMeta(page.book, page.origin, page.lang);
};

export const ErrorBoundary = RouteErrorBoundary;

export default function Book() {
  return <BookPage />;
}
