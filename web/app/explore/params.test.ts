import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  clearFilters,
  type ExploreState,
  exploreHref,
  parseExploreParams,
  publishedSince,
  toApiQuery,
  toFacetsQuery,
  toSearchParams,
} from './params';

const P1 = '1c48198d-b462-5197-888f-6c816b3963b3';
const P2 = '56cf5922-3043-5179-8b2d-c2535ab5e8b5';
const NOW = new Date('2026-11-16T10:00:00Z');

const url = (query: string, path = '/kerko') => new URL(`http://localhost:5174${path}?${query}`);

const full: ExploreState = {
  genre: 'Fiction',
  q: 'han',
  publisherIds: [P1, P2],
  language: 'sq',
  maxPrice: 1000,
  since: 'year',
  hideOwned: true,
  sort: 'title',
  view: 'list',
  page: 3,
};

describe('explore params', () => {
  it('parse → toApiQuery round-trips a full state', () => {
    const query = toSearchParams(full).toString();
    const parsed = parseExploreParams(url(query));
    expect(parsed).toEqual(full);
    expect(toSearchParams(parsed).toString()).toBe(query);

    const api = toApiQuery(parsed, NOW);
    expect(api.get('genre')).toBe('Fiction');
    expect(api.get('search')).toBe('han');
    expect(api.getAll('publisherId')).toEqual([P1, P2]);
    expect(api.get('language')).toBe('sq');
    expect(api.get('maxPrice')).toBe('1000');
    expect(api.get('publishedSince')).toBe('2026-01-01');
    expect(api.get('hideOwned')).toBe('true');
    expect(api.get('sort')).toBe('title');
    expect(api.get('page')).toBe('3');
    expect(api.get('limit')).toBe('24');
    // The API never sees UI-only parameters.
    expect(api.has('view')).toBe(false);
    expect(api.has('q')).toBe(false);
    expect(api.has('since')).toBe(false);

    const facets = toFacetsQuery(parsed, NOW);
    expect(['sort', 'page', 'limit'].some((key) => facets.has(key))).toBe(false);
    expect(facets.get('search')).toBe('han');
  });

  it('drops junk: page=-3, sort=evil, maxPrice=abc, publisherId=not-a-uuid', () => {
    const state = parseExploreParams(
      url(
        'page=-3&sort=evil&maxPrice=abc&publisherId=not-a-uuid&publisherId=' +
          `${P1}&language=Shqip&since=forever&view=table&hideOwned=yes&genre=a%2Fb`,
      ),
    );
    expect(state).toEqual({
      publisherIds: [P1],
      hideOwned: false,
      sort: 'new',
      view: 'grid',
      page: 1,
    });
    const api = toApiQuery(state, NOW);
    expect([...api.keys()].sort()).toEqual(['limit', 'page', 'publisherId', 'sort']);
    expect(parseExploreParams(url('page=2.5')).page).toBe(1);
    expect(parseExploreParams(url('page=99999999999')).page).toBe(10_000);
    expect(parseExploreParams(url('maxPrice=99999999999')).maxPrice).toBeUndefined();
    expect(parseExploreParams(url('maxPrice=-1')).maxPrice).toBeUndefined();
  });

  it.each([
    ['Letërsi', 'Letërsi'],
    ['Sci-Fi', 'Sci-Fi'],
    ['Non-fiction', 'Non-fiction'],
    ['Biografi & Kujtime', 'Biografi & Kujtime'],
    ['Fiction', 'Fiction'],
    ['', undefined],
    ['   ', undefined],
    [' Fiction', undefined],
    ['a/b', undefined],
    ['a\\b', undefined],
    ['tab\there', undefined],
    ['x'.repeat(101), undefined],
  ])('genre %j parses to %j', (raw, expected) => {
    expect(parseExploreParams(url(`genre=${encodeURIComponent(raw)}`)).genre).toBe(expected);
    expect(parseExploreParams(url(''), { genre: raw }).genre).toBe(expected);
  });

  it('a non-ASCII genre round-trips through its path', () => {
    const state = parseExploreParams(url(''), { genre: 'Letërsi' });
    const href = exploreHref('genre', { ...state, sort: 'title' });
    expect(href).toBe('/eksploro/Let%C3%ABrsi?sort=title');
    const back = new URL(`http://localhost:5174${href}`);
    const genre = decodeURIComponent(back.pathname.split('/')[2] ?? '');
    expect(parseExploreParams(back, { genre })).toEqual({ ...state, sort: 'title' });
    expect(exploreHref('search', { ...state, q: 'han', genre: 'Sci-Fi' })).toBe(
      '/kerko?q=han&genre=Sci-Fi',
    );
  });

  it('since=year maps to publishedSince = Jan 1 of the current year', () => {
    expect(publishedSince('year', NOW)).toBe('2026-01-01');
    expect(publishedSince('30d', NOW)).toBe('2026-10-17');
    expect(toApiQuery(parseExploreParams(url('since=year')), NOW).get('publishedSince')).toBe(
      '2026-01-01',
    );
  });

  it('a q of 250 characters is truncated to 200 before reaching the API', () => {
    const state = parseExploreParams(url(`q=${'a'.repeat(250)}`));
    expect(toApiQuery(state).get('search')).toHaveLength(200);
    expect(parseExploreParams(url('q=%20%20')).q).toBeUndefined();
  });

  it('the route scope wins: a genre path and a publisher path', () => {
    const genre = parseExploreParams(url('genre=Poetry', '/eksploro/Fiction'), {
      genre: 'Fiction',
    });
    expect(genre.genre).toBe('Fiction');
    const publisher = parseExploreParams(url(`publisherId=${P2}`, `/botues/${P1}`), {
      publisherId: P1,
    });
    expect(publisher.publisherIds).toEqual([P1]);
  });

  it('links keep the scope in the path and leave defaults out', () => {
    const base = parseExploreParams(url(''), { genre: 'Fiction' });
    expect(exploreHref('genre', base)).toBe('/eksploro/Fiction');
    expect(exploreHref('all', { ...base, genre: undefined })).toBe('/eksploro');
    expect(exploreHref('genre', { ...base, sort: 'title', page: 2 })).toBe(
      '/eksploro/Fiction?sort=title&page=2',
    );
    const pub = parseExploreParams(url('genre=Poetry'), { publisherId: P1 });
    expect(exploreHref('publisher', pub)).toBe(`/botues/${P1}?genre=Poetry`);
    expect(exploreHref('search', { ...base, q: 'han', genre: 'Poetry' })).toBe(
      '/kerko?q=han&genre=Poetry',
    );
  });

  it('counts and clears filters but keeps the scope, query, sort and view', () => {
    expect(activeFilterCount(full, 'genre')).toBe(6);
    expect(activeFilterCount(full, 'search')).toBe(7);
    const cleared = clearFilters(full, 'search');
    expect(exploreHref('search', cleared)).toBe('/kerko?q=han&sort=title&view=list');
    expect(exploreHref('genre', clearFilters(full, 'genre'))).toBe(
      '/eksploro/Fiction?q=han&sort=title&view=list',
    );
  });
});
