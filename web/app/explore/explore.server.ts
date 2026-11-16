import { data, redirect } from 'react-router';
import { createI18n } from '../i18n';
import type { Facets, PublisherSummary, StoreBook } from '../lib/types';
import { ApiError, type ApiResult, apiFetch } from '../server/api.server';
import { env } from '../server/env.server';
import { detectLanguage } from '../server/i18n.server';
import { getSession } from '../server/session.server';
import type { ExploreData } from './ExplorePage';
import {
  type ExploreMode,
  type ExploreState,
  exploreHref,
  isUuid,
  PAGE_SIZE,
  parseExploreParams,
  toApiQuery,
  toFacetsQuery,
} from './params';

/** The catalogue's genres; the API's list is added to these, so a new genre works before it has copy. */
export const KNOWN_GENRES = ['Fiction', 'History', 'Poetry', 'Essays', 'Children'];

type GenresResponse = { genres: Array<{ genre: string }> };

/** The catalogue's genre list, fetched at most once per request (shared by validation and the bar). */
export function genresLoader(request: Request) {
  let call: Promise<ApiResult<GenresResponse>> | undefined;
  return () => {
    call ??= apiFetch<GenresResponse>(request, '/books/genres', { auth: 'optional' });
    return call;
  };
}

/**
 * Whether the catalogue offers `genre`: a known genre needs no call, any other must be in the
 * API's list (an unreachable list counts as "no"). Shared by the page and the count route, so
 * both agree on which genre filters apply.
 */
export async function isOfferedGenre(
  genre: string,
  genresList: () => Promise<ApiResult<GenresResponse>>,
): Promise<boolean> {
  if (KNOWN_GENRES.includes(genre)) return true;
  return genresList().then(
    (result) => result.data.genres.some((g) => g.genre === genre),
    () => false,
  );
}

type BooksResponse = {
  books: StoreBook[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

const emptyFacets = (): Facets => ({ total: 0, genres: [], publishers: [], languages: [] });
const emptyPage = (page: number): BooksResponse['pagination'] => ({
  page,
  limit: PAGE_SIZE,
  total: 0,
  totalPages: 0,
});

const notFound = () => new Response('Not Found', { status: 404 });

/** A 400 means the query was refused; parameters are sanitised first, so this is only a safety net. */
const isBadRequest = (reason: unknown) => reason instanceof ApiError && reason.status === 400;

function fulfilled<T>(result: PromiseSettledResult<{ data: T; setCookie?: string }>) {
  return result.status === 'fulfilled' ? result.value : null;
}

/**
 * The loader behind every Explore mode. Books, facets, the genre list and (for a publisher) its
 * summary are fetched in parallel. A 400 shows the empty state; an unreachable API shows an
 * error state (503); an unknown genre or publisher is a 404 inside the site shell.
 */
export async function loadExplore(
  request: Request,
  params: { genre?: string; publisherId?: string },
  mode: ExploreMode,
) {
  const lang = detectLanguage(request);
  const { t } = createI18n(lang);
  const url = new URL(request.url);

  if (mode === 'publisher' && !isUuid(params.publisherId)) throw notFound();
  if (mode === 'genre' && !params.genre) throw notFound();

  const session = await getSession(request);
  const signedIn = Boolean(session.get('token') && session.get('user'));
  const state: ExploreState = parseExploreParams(url, params);
  if (mode === 'genre' && state.genre !== params.genre) throw notFound();
  // A query belongs to search results only.
  if (mode !== 'search') state.q = undefined;
  // Only a signed-in reader owns books; a guest's hideOwned is dropped, not forwarded.
  if (!signedIn) state.hideOwned = false;

  // Canonical: the same page without the view switch; page 1 is never written out.
  const canonicalOf = (s: ExploreState) =>
    `${env.PUBLIC_ORIGIN}${exploreHref(mode, { ...s, view: 'grid' })}`;

  const base = {
    mode,
    lang,
    state,
    signedIn,
    canonical: canonicalOf(state),
    books: [] as StoreBook[],
    pagination: emptyPage(state.page),
    facets: emptyFacets(),
    genres: [] as string[],
    publisher: null as PublisherSummary | null,
    description: null as string | null,
  };

  if (mode === 'search' && !state.q) {
    return data<ExploreData>({
      ...base,
      status: 'prompt',
      title: t('explore.searchPrompt'),
    });
  }

  const opts = { auth: 'optional' as const };
  const genresList = genresLoader(request);
  // Validate the genre before any catalogue query is built. A path genre is the page itself
  // (404); a query genre is only a filter (dropped).
  if (state.genre && !(await isOfferedGenre(state.genre, genresList))) {
    if (mode === 'genre') throw notFound();
    state.genre = undefined;
  }

  const [booksResult, facetsResult, genresResult, publisherResult] = await Promise.allSettled([
    apiFetch<BooksResponse>(request, `/books?${toApiQuery(state)}`, opts),
    apiFetch<Facets>(request, `/books/facets?${toFacetsQuery(state)}`, opts),
    genresList(),
    mode === 'publisher'
      ? apiFetch<{ publisher: PublisherSummary }>(
          request,
          `/publishers/${encodeURIComponent(state.publisherIds[0] ?? '')}`,
          opts,
        )
      : Promise.resolve(null),
  ]);

  if (publisherResult.status === 'rejected') {
    const reason = publisherResult.reason;
    if (reason instanceof ApiError && (reason.status === 404 || reason.status === 400)) {
      throw notFound();
    }
  }

  const apiGenres = fulfilled(genresResult)?.data.genres.map((g) => g.genre) ?? [];
  const genres = [
    ...KNOWN_GENRES,
    ...apiGenres.filter((genre) => !KNOWN_GENRES.includes(genre)).sort(),
  ];

  const books = fulfilled(booksResult);
  const facets = fulfilled(facetsResult);
  // Albanian first, as in the mockup; other languages keep the API's order.
  facets?.data.languages.sort((a, b) => Number(b.language === 'sq') - Number(a.language === 'sq'));
  const publisher =
    publisherResult.status === 'fulfilled' ? (publisherResult.value?.data.publisher ?? null) : null;

  const failures = [booksResult, facetsResult, publisherResult]
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason);
  const unavailable = failures.some((reason) => !isBadRequest(reason));
  for (const reason of failures) console.error('explore: API call failed', reason);

  const pagination = books?.data.pagination ?? emptyPage(state.page);
  if (books && pagination.totalPages > 0 && state.page > pagination.totalPages) {
    throw redirect(exploreHref(mode, { ...state, page: pagination.totalPages }));
  }

  let title: string;
  let description: string | null = null;
  switch (mode) {
    case 'genre': {
      const genre = state.genre ?? '';
      title = t(`genres.${genre}`, { defaultValue: genre });
      description = t(`genreIntro.${genre}`, { defaultValue: '' }) || null;
      break;
    }
    case 'search':
      title = t('explore.searchTitle', { q: state.q });
      break;
    case 'publisher':
      title = publisher?.name ?? t('explore.chips.publisher');
      break;
    default:
      title = t('explore.all');
  }

  const setCookie = [booksResult, facetsResult, genresResult, publisherResult]
    .map((r) => (r.status === 'fulfilled' ? r.value?.setCookie : undefined))
    .find(Boolean);
  const headers = setCookie ? { 'Set-Cookie': setCookie } : undefined;

  return data<ExploreData>(
    {
      ...base,
      state,
      canonical: canonicalOf(state),
      status: unavailable && !books ? 'error' : 'ok',
      books: books?.data.books ?? [],
      pagination,
      facets: facets?.data ?? emptyFacets(),
      genres,
      publisher,
      title,
      description,
    },
    { status: unavailable && !books ? 503 : 200, headers },
  );
}
