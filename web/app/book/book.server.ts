import { data, redirect } from 'react-router';
import { isUuid } from '../explore/params';
import { bookHref } from '../lib/format';
import type { BookDetail, StoreBook, Viewer } from '../lib/types';
import { ApiError, apiFetch } from '../server/api.server';
import { env } from '../server/env.server';
import { detectLanguage } from '../server/i18n.server';
import type { BookPageData } from './BookPage';

type BookResponse = { book: BookDetail; viewer?: Viewer };
type BooksResponse = { books: StoreBook[] };

/** One more than a shelf shows, so dropping the current book still leaves six. */
const SHELF_FETCH = 7;
const SHELF_SIZE = 6;

const notFound = () => new Response('Not Found', { status: 404 });

/**
 * The book page: the book (with the viewer block when signed in) first, then its three shelves in
 * parallel. A missing or wrong slug is a 301 to the canonical URL; an unknown book a 404 inside the
 * shell; a shelf that fails is simply left out.
 */
export async function loadBook(request: Request, params: { id?: string; slug?: string }) {
  if (!isUuid(params.id)) throw notFound();
  const id = params.id;
  const lang = detectLanguage(request);

  let result: Awaited<ReturnType<typeof apiFetch<BookResponse>>>;
  try {
    result = await apiFetch<BookResponse>(request, `/books/${encodeURIComponent(id)}`, {
      auth: 'optional',
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw notFound();
    console.error('book detail failed', error);
    throw new Response('Service Unavailable', { status: 503 });
  }
  const { book, viewer } = result.data;
  const setCookie = result.setCookie;

  const path = bookHref(book);
  const url = new URL(request.url);
  if (url.pathname !== path) {
    throw redirect(`${path}${url.search}`, {
      status: 301,
      ...(setCookie ? { headers: { 'Set-Cookie': setCookie } } : {}),
    });
  }

  // The token (if any) was already checked by the book call; an expired one is gone from now on.
  const shelf = async (query: Record<string, string>) => {
    const search = new URLSearchParams({ ...query, limit: String(SHELF_FETCH) });
    const { data: page } = await apiFetch<BooksResponse>(request, `/books?${search}`, {
      auth: setCookie ? 'none' : 'optional',
    });
    return page.books.filter((b) => b.id !== book.id);
  };

  const [publisher, similar, author] = await Promise.allSettled([
    shelf({ publisherId: book.publisher.id }),
    shelf({ genre: book.genre }),
    // Search matches titles and namesakes too: keep only this exact author.
    shelf({ search: book.author }).then((books) => books.filter((b) => b.author === book.author)),
  ]);
  const settled = (result: PromiseSettledResult<StoreBook[]>, name: string) => {
    if (result.status === 'fulfilled') return result.value.slice(0, SHELF_SIZE);
    console.error(`book shelf ${name} failed`, result.reason);
    return [];
  };

  const payload: BookPageData = {
    lang,
    book,
    viewer: viewer ?? null,
    path,
    origin: env.PUBLIC_ORIGIN,
    checkoutKey: crypto.randomUUID(),
    shelves: {
      publisher: settled(publisher, 'publisher'),
      similar: settled(similar, 'similar'),
      // Shown only when the author has at least one other book here.
      author: settled(author, 'author'),
    },
  };
  return data(payload, setCookie ? { headers: { 'Set-Cookie': setCookie } } : undefined);
}
