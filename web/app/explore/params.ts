// The Explore page's state lives entirely in the URL. These helpers read it defensively (junk is
// dropped, never forwarded), write it back as a canonical query string, and map it to the API.
// Pure module: shared by loaders, the phone sheet's count route and the components.

export const SORTS = ['new', 'top', 'title', 'price_asc', 'price_desc'] as const;
export type Sort = (typeof SORTS)[number];
export const VIEWS = ['grid', 'list'] as const;
export type View = (typeof VIEWS)[number];
export const SINCE = ['30d', 'year'] as const;
export type Since = (typeof SINCE)[number];

/** The price filter is a maximum only; these are the offered steps, in cents. */
export const PRICE_STEPS = [500, 1000, 1500] as const;

export const PAGE_SIZE = 24;
export const MAX_QUERY = 200;
const MAX_PAGE = 10_000;
const MAX_PUBLISHERS = 20;
const MAX_CENTS = 2_147_483_647;

export type ExploreMode = 'all' | 'genre' | 'search' | 'publisher';

export type ExploreState = {
  genre?: string;
  q?: string;
  publisherIds: string[];
  language?: string;
  maxPrice?: number;
  since?: Since;
  hideOwned: boolean;
  sort: Sort;
  view: View;
  page: number;
};

export type RouteScope = { genre?: string; publisherId?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** No control characters and no path separators; the authoritative check is the catalogue's list. */
const GENRE_FORBIDDEN = /[\p{Cc}/\\]/u;
const MAX_GENRE = 100;
const LANGUAGE = /^[a-z]{2,3}$/;

export const isUuid = (value: string | undefined): value is string =>
  value !== undefined && UUID.test(value);

/**
 * Whether a genre is well-formed. Publishers type genres as free text ("Letërsi", "Sci-Fi"), so
 * any trimmed name of 1–100 characters passes; whether the catalogue has it is checked later.
 */
export function isGenreShaped(value: string | null | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_GENRE &&
    value === value.trim() &&
    !GENRE_FORBIDDEN.test(value)
  );
}

function oneOf<T extends string>(values: readonly T[], raw: string | null): T | undefined {
  return values.find((value) => value === raw);
}

function parseIntStrict(raw: string | null, max: number): number | undefined {
  if (raw === null || !/^\d{1,15}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value <= max ? value : undefined;
}

/** Trimmed and cut to the API's limit; empty means no query. */
export function cleanQuery(raw: string | null | undefined): string | undefined {
  const q = (raw ?? '').trim().slice(0, MAX_QUERY).trim();
  return q || undefined;
}

/**
 * Reads the page state from the URL and the route params. The route's genre wins over a
 * `genre` query; a publisher route scopes the results to that publisher only.
 */
export function parseExploreParams(url: URL, route: RouteScope = {}): ExploreState {
  const p = url.searchParams;
  const rawGenre = route.genre ?? p.get('genre') ?? undefined;
  const publisherIds = isUuid(route.publisherId)
    ? [route.publisherId.toLowerCase()]
    : [
        ...new Set(
          p
            .getAll('publisherId')
            .filter(isUuid)
            .map((id) => id.toLowerCase()),
        ),
      ].slice(0, MAX_PUBLISHERS);
  const language = p.get('language') ?? '';
  const page = parseIntStrict(p.get('page'), Number.MAX_SAFE_INTEGER);

  const state: ExploreState = {
    publisherIds,
    hideOwned: p.get('hideOwned') === 'true',
    sort: oneOf(SORTS, p.get('sort')) ?? 'new',
    view: oneOf(VIEWS, p.get('view')) ?? 'grid',
    page: Math.min(MAX_PAGE, Math.max(1, page ?? 1)),
  };
  if (isGenreShaped(rawGenre)) state.genre = rawGenre;
  const q = cleanQuery(p.get('q'));
  if (q) state.q = q;
  if (LANGUAGE.test(language)) state.language = language;
  const maxPrice = parseIntStrict(p.get('maxPrice'), MAX_CENTS);
  if (maxPrice !== undefined) state.maxPrice = maxPrice;
  const since = oneOf(SINCE, p.get('since'));
  if (since) state.since = since;
  return state;
}

/** Fields that are carried by the path for a mode, so they never go into its query string. */
function pathFields(mode: ExploreMode) {
  return {
    genre: mode === 'all' || mode === 'genre',
    publisherIds: mode === 'publisher',
  };
}

/**
 * The page state as URL query parameters, defaults left out (sort=new, view=grid, page=1).
 * `parseExploreParams(url with toSearchParams(state))` gives the same state back.
 */
export function toSearchParams(state: ExploreState, mode: ExploreMode = 'search'): URLSearchParams {
  const inPath = pathFields(mode);
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.genre && !inPath.genre) p.set('genre', state.genre);
  if (!inPath.publisherIds) for (const id of state.publisherIds) p.append('publisherId', id);
  if (state.language) p.set('language', state.language);
  if (state.maxPrice !== undefined) p.set('maxPrice', String(state.maxPrice));
  if (state.since) p.set('since', state.since);
  if (state.hideOwned) p.set('hideOwned', 'true');
  if (state.sort !== 'new') p.set('sort', state.sort);
  if (state.view !== 'grid') p.set('view', state.view);
  if (state.page > 1) p.set('page', String(state.page));
  return p;
}

/** The path for a mode; genre and publisher pages carry their scope in the path. */
export function basePath(mode: ExploreMode, state: Pick<ExploreState, 'genre' | 'publisherIds'>) {
  switch (mode) {
    case 'search':
      return '/kerko';
    case 'publisher':
      return `/botues/${state.publisherIds[0] ?? ''}`;
    default:
      return state.genre ? `/eksploro/${encodeURIComponent(state.genre)}` : '/eksploro';
  }
}

/** A link to the page in `state`. Changing a filter should reset `page` to 1 first. */
export function exploreHref(mode: ExploreMode, state: ExploreState): string {
  // Picking a genre on /eksploro moves to /eksploro/:genre and back.
  const effective: ExploreMode = mode === 'all' || mode === 'genre' ? 'genre' : mode;
  const query = toSearchParams(state, effective).toString();
  return `${basePath(effective, state)}${query ? `?${query}` : ''}`;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** `since` as the API's `publishedSince`: 30 days before today, or 1 January this year (UTC). */
export function publishedSince(since: Since, now: Date = new Date()): string {
  if (since === 'year') return `${now.getUTCFullYear()}-01-01`;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 30));
  return isoDate(from);
}

/** The `GET /books` query for a state (page size 24). */
export function toApiQuery(state: ExploreState, now: Date = new Date()): URLSearchParams {
  const p = new URLSearchParams();
  if (state.genre) p.set('genre', state.genre);
  if (state.q) p.set('search', state.q);
  for (const id of state.publisherIds) p.append('publisherId', id);
  if (state.language) p.set('language', state.language);
  if (state.maxPrice !== undefined) p.set('maxPrice', String(state.maxPrice));
  if (state.since) p.set('publishedSince', publishedSince(state.since, now));
  if (state.hideOwned) p.set('hideOwned', 'true');
  p.set('sort', state.sort);
  p.set('page', String(state.page));
  p.set('limit', String(PAGE_SIZE));
  return p;
}

/** The `GET /books/facets` query: the same filters without sort and paging. */
export function toFacetsQuery(state: ExploreState, now: Date = new Date()): URLSearchParams {
  const p = toApiQuery(state, now);
  for (const key of ['sort', 'page', 'limit']) p.delete(key);
  return p;
}

/** How many filters are active (the phone's "Filtrat · N"). The page's own scope does not count. */
export function activeFilterCount(state: ExploreState, mode: ExploreMode): number {
  return (
    (mode === 'publisher' ? 0 : state.publisherIds.length) +
    (state.genre && (mode === 'search' || mode === 'publisher') ? 1 : 0) +
    (state.language ? 1 : 0) +
    (state.maxPrice !== undefined ? 1 : 0) +
    (state.since ? 1 : 0) +
    (state.hideOwned ? 1 : 0)
  );
}

/** The state with every filter removed; the page's scope, query, sort and view stay. */
export function clearFilters(state: ExploreState, mode: ExploreMode): ExploreState {
  return {
    q: state.q,
    genre: mode === 'genre' ? state.genre : undefined,
    publisherIds: mode === 'publisher' ? state.publisherIds : [],
    hideOwned: false,
    sort: state.sort,
    view: state.view,
    page: 1,
  };
}

/** The form the sidebar, the sort select and the "Apliko" fallback share. */
export const FILTERS_FORM_ID = 'explore-filters';
