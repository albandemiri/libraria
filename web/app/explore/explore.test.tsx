import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { createI18n } from '../i18n';
import type { Facets, PublisherSummary, StoreBook } from '../lib/types';
import { loader as exploreLoader, meta as exploreMeta } from '../routes/explore';
import { loader as countLoader } from '../routes/explore-count';
import { loader as publisherLoader } from '../routes/publisher';
import { loader as searchLoader } from '../routes/search';
import { type ExploreData, ExplorePage } from './ExplorePage';
import { type ExploreState, parseExploreParams } from './params';

// jsdom cannot compute colours; contrast is checked in the design package.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const P1 = '1c48198d-b462-5197-888f-6c816b3963b3';
const P2 = '56cf5922-3043-5179-8b2d-c2535ab5e8b5';
const P3 = '3179c2d0-524d-5ac4-b884-025de7590087';

function book(id: string, overrides: Partial<StoreBook> = {}): StoreBook {
  return {
    id,
    title: `Libri ${id}`,
    author: `Autori ${id}`,
    isbn13: null,
    description: null,
    genre: 'Fiction',
    language: 'sq',
    price: { amountCents: 599, currency: 'EUR' },
    coverImageUrl: `/api/v1/books/${id}/cover?v=1`,
    publishedAt: '2026-11-05T00:00:00.000Z',
    publisher: { id: P1, name: 'Kodra e Blertë' },
    forSale: true,
    mediaType: 'ebook',
    durationSeconds: null,
    ...overrides,
  };
}

const facets: Facets = {
  total: 18,
  genres: [
    { genre: 'Fiction', bookCount: 18 },
    { genre: 'History', bookCount: 10 },
  ],
  publishers: [
    { id: P1, name: 'Kodra e Blertë', bookCount: 5 },
    { id: P2, name: 'Shtëpia Botuese Ura', bookCount: 5 },
    { id: P3, name: 'Pema e Kuqe Botime', bookCount: 0 },
  ],
  languages: [
    { language: 'en', bookCount: 2 },
    { language: 'sq', bookCount: 16 },
  ],
};

const publisher: PublisherSummary = {
  id: P1,
  name: 'Kodra e Blertë',
  country: 'AL',
  bookCount: 13,
  genres: ['Fiction'],
  newestYear: 2026,
};

function state(overrides: Partial<ExploreState> = {}): ExploreState {
  return { ...parseExploreParams(new URL('http://x/'), { genre: 'Fiction' }), ...overrides };
}

function pageData(overrides: Partial<ExploreData> = {}): ExploreData {
  const books = [book('a'), book('b', { language: 'en', title: 'The Quiet Harbour' }), book('c')];
  return {
    mode: 'genre',
    lang: 'sq',
    status: 'ok',
    state: state(),
    signedIn: false,
    books,
    pagination: { page: 1, limit: 24, total: 18, totalPages: 1 },
    facets,
    genres: ['Children', 'Essays', 'Fiction', 'History', 'Poetry'],
    publisher: null,
    title: 'Prozë',
    description: 'Romane dhe tregime nga autorë shqiptarë bashkëkohorë.',
    canonical: 'http://localhost:5174/eksploro/Fiction',
    ...overrides,
  };
}

function renderPage(data: ExploreData, path = '/eksploro/Fiction') {
  const Stub = createRoutesStub([
    { path: '/eksploro/:genre?', loader: () => data, Component: ExplorePage },
    { path: '/kerko', loader: () => data, Component: ExplorePage },
    { path: '/botues/:publisherId', loader: () => data, Component: ExplorePage },
  ]);
  return render(
    <I18nextProvider i18n={createI18n(data.lang)}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch mock that answers each API path; unknown paths fail the test loudly. */
function api(routes: Record<string, () => Response>) {
  const mock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v1', '');
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected API call ${url}`);
    return handler();
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const calls = (mock: ReturnType<typeof api>) => mock.mock.calls.map(([u]) => new URL(String(u)));

const okRoutes = {
  '/books': () =>
    json({ books: [book('a')], pagination: { page: 1, limit: 24, total: 1, totalPages: 1 } }),
  '/books/facets': () => json({ ...facets, total: 1 }),
  '/books/genres': () => json({ genres: facets.genres }),
};

// biome-ignore lint/suspicious/noExplicitAny: the loaders only read request and params
const args = (path: string, params: Record<string, string> = {}): any => ({
  request: new Request(`http://localhost:5174${path}`),
  params,
  context: {},
});

describe('ExplorePage', () => {
  it('shows the masthead, intro, count line, genre bar and EN tag', async () => {
    const { container } = renderPage(pageData());
    expect(await screen.findByRole('heading', { level: 1, name: 'Prozë' })).toBeInTheDocument();
    expect(container.textContent).toContain('Romane dhe tregime nga autorë shqiptarë');
    // Two publishers have books under the current filters.
    expect(container.textContent).toContain('18 libra · 2 botues');
    const bar = screen.getByRole('navigation', { name: 'Zhanret' });
    expect(within(bar).getByRole('link', { name: 'Prozë' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(bar).getByRole('link', { name: 'Të gjitha' })).toHaveAttribute(
      'href',
      '/eksploro',
    );
    expect(screen.getByText('EN')).toBeInTheDocument();
  });

  it('removing one chip keeps every other filter in the link', async () => {
    renderPage(
      pageData({
        state: state({ publisherIds: [P1, P2], maxPrice: 1000, since: 'year', sort: 'title' }),
      }),
    );
    const remove = await screen.findByRole('link', { name: 'Hiq filtrin Kodra e Blertë' });
    const href = new URL(remove.getAttribute('href') ?? '', 'http://x');
    expect(href.pathname).toBe('/eksploro/Fiction');
    expect(href.searchParams.getAll('publisherId')).toEqual([P2]);
    expect(href.searchParams.get('maxPrice')).toBe('1000');
    expect(href.searchParams.get('since')).toBe('year');
    expect(href.searchParams.get('sort')).toBe('title');
    const chips = screen.getByRole('list', { name: 'Filtrat aktivë' });
    expect(within(chips).getByText('Deri në 10 €')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pastro të gjitha' })).toHaveAttribute(
      'href',
      '/eksploro/Fiction?sort=title',
    );
    expect(screen.getByRole('button', { name: 'Filtrat · 4' })).toBeInTheDocument();
  });

  it('a sort change made while a filter change loads keeps both', async () => {
    let release: () => void = () => {};
    const Stub = createRoutesStub([
      {
        path: '/eksploro/:genre',
        // The state follows the URL; the second load is held back, as on a slow network.
        loader: async ({ request }) => {
          const url = new URL(request.url);
          if (url.search) await new Promise<void>((resolve) => (release = resolve));
          return pageData({ state: parseExploreParams(url, { genre: 'Fiction' }) });
        },
        Component: ExplorePage,
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={['/eksploro/Fiction']} />
      </I18nextProvider>,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: /Kodra e Blertë/ }));
    fireEvent.change(screen.getByLabelText('Rendit'), { target: { value: 'title' } });
    release();
    const chip = await screen.findByRole('link', { name: 'Hiq filtrin Kodra e Blertë' });
    await waitFor(() => expect(chip).toHaveAttribute('href', '/eksploro/Fiction?sort=title'));
    expect(screen.getByLabelText('Rendit')).toHaveValue('title');
  });

  it('shows the empty state with Pastro filtrat when total is 0', async () => {
    renderPage(
      pageData({
        books: [],
        pagination: { page: 1, limit: 24, total: 0, totalPages: 0 },
        facets: { ...facets, total: 0 },
        state: state({ language: 'en', maxPrice: 500 }),
      }),
    );
    const clear = await screen.findByRole('link', { name: 'Pastro filtrat' });
    expect(clear).toHaveAttribute('href', '/eksploro/Fiction');
    expect(screen.queryByRole('navigation', { name: 'Faqosja' })).not.toBeInTheDocument();
  });

  it('hides the hide-owned toggle for guests', async () => {
    const { unmount } = renderPage(pageData({ signedIn: false }));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('switch', { name: 'Fshih librat që i kam' })).not.toBeInTheDocument();
    unmount();
    renderPage(pageData({ signedIn: true }));
    expect(
      await screen.findByRole('switch', { name: 'Fshih librat që i kam' }),
    ).toBeInTheDocument();
  });

  it('publisher mode titles the page with the publisher name', async () => {
    const mock = api({ ...okRoutes, [`/publishers/${P1}`]: () => json({ publisher }) });
    const result = await publisherLoader(
      args(`/botues/${P1}?publisherId=${P2}`, { publisherId: P1 }),
    );
    expect(result.data.title).toBe('Kodra e Blertë');
    // The catalogue is scoped to the route's publisher only.
    const books = calls(mock).find((u) => u.pathname.endsWith('/books'));
    expect(books?.searchParams.getAll('publisherId')).toEqual([P1]);

    renderPage(result.data, `/botues/${P1}`);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kodra e Blertë' }),
    ).toBeInTheDocument();
    // The count line names only this publisher (the facet ignores its own filter).
    expect(document.body.textContent).toContain('1 libër · 1 botues');
    // No publisher filter on a publisher's own catalogue.
    expect(screen.queryByRole('group', { name: 'Botuesi' })).not.toBeInTheDocument();
  });

  it.each(['grid', 'list'] as const)('explore page passes axe in %s view', async (view) => {
    const { container } = renderPage(
      pageData({
        signedIn: true,
        state: state({ view, publisherIds: [P1], since: '30d' }),
        pagination: { page: 2, limit: 24, total: 60, totalPages: 3 },
      }),
    );
    await screen.findByRole('heading', { level: 1 });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('search with no query prompts for a search', async () => {
    renderPage(pageData({ mode: 'search', status: 'prompt', title: 'Kërko', books: [] }), '/kerko');
    expect(await screen.findByRole('heading', { level: 1, name: 'Kërko' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveAttribute('name', 'q');
  });
});

describe('Explore loaders', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cleans junk before calling the API', async () => {
    const mock = api(okRoutes);
    await searchLoader(
      args(`/kerko?page=-3&sort=evil&maxPrice=abc&publisherId=not-a-uuid&q=${'x'.repeat(250)}`),
    );
    const books = calls(mock).find((u) => u.pathname.endsWith('/books'));
    expect(books?.searchParams.get('page')).toBe('1');
    expect(books?.searchParams.get('sort')).toBe('new');
    expect(books?.searchParams.get('limit')).toBe('24');
    expect(books?.searchParams.has('maxPrice')).toBe(false);
    expect(books?.searchParams.has('publisherId')).toBe(false);
    expect(books?.searchParams.get('search')).toHaveLength(200);
    // A query only belongs to search results.
    const genre = api(okRoutes);
    await exploreLoader(args('/eksploro/Fiction?q=han', { genre: 'Fiction' }));
    expect(calls(genre).every((u) => !u.searchParams.has('search'))).toBe(true);
    // A guest's hideOwned never reaches the API.
    const guest = api(okRoutes);
    await exploreLoader(args('/eksploro?hideOwned=true'));
    expect(calls(guest).every((u) => !u.searchParams.has('hideOwned'))).toBe(true);
  });

  it('an API 400 shows the empty state, not an error page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = () => json({ error: { code: 'VALIDATION_FAILED', message: 'no' } }, 400);
    api({ ...okRoutes, '/books': bad, '/books/facets': bad });
    const result = await exploreLoader(args('/eksploro'));
    expect(result.data.status).toBe('ok');
    expect(result.data.books).toEqual([]);
    expect(result.data.pagination.total).toBe(0);
  });

  it('an unknown genre and an unknown publisher are 404s', async () => {
    api(okRoutes);
    await expect(exploreLoader(args('/eksploro/Nope', { genre: 'Nope' }))).rejects.toMatchObject({
      status: 404,
    });
    const missing = () => json({ error: { code: 'NOT_FOUND', message: 'no' } }, 404);
    api({ ...okRoutes, [`/publishers/${P1}`]: missing });
    await expect(publisherLoader(args(`/botues/${P1}`, { publisherId: P1 }))).rejects.toMatchObject(
      {
        status: 404,
      },
    );
    await expect(
      publisherLoader(args('/botues/not-a-uuid', { publisherId: 'not-a-uuid' })),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('search without a query makes no API call', async () => {
    const mock = api(okRoutes);
    const result = await searchLoader(args('/kerko?q=%20'));
    expect(mock).not.toHaveBeenCalled();
    expect(result.data.status).toBe('prompt');
    expect(result.data.title).toBe('Kërko');
    const withQ = await searchLoader(args('/kerko?q=han'));
    expect(withQ.data.title).toBe('Rezultatet për „han“');
  });

  it('meta: a title per mode and a canonical URL without view or page=1', async () => {
    api(okRoutes);
    const result = await exploreLoader(
      args('/eksploro/Fiction?view=list&page=1&sort=title', { genre: 'Fiction' }),
    );
    expect(result.data.canonical).toBe('http://localhost:5174/eksploro/Fiction?sort=title');
    // biome-ignore lint/suspicious/noExplicitAny: only data is used
    const tags = exploreMeta({ data: result.data, matches: [] } as any) ?? [];
    expect(tags).toContainEqual({ title: 'Prozë — Libraria' });
    expect(tags).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: 'http://localhost:5174/eksploro/Fiction?sort=title',
    });
  });

  it('a page past the end redirects to the last page', async () => {
    api({
      ...okRoutes,
      '/books': () =>
        json({ books: [], pagination: { page: 9, limit: 24, total: 30, totalPages: 2 } }),
    });
    const response = await exploreLoader(args('/eksploro?page=9&sort=title')).catch((r) => r);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/eksploro?sort=title&page=2');
  });

  it('validates a query genre before any catalogue call: unknown is dropped', async () => {
    const mock = api(okRoutes);
    const result = await searchLoader(args('/kerko?q=han&genre=Nope'));
    expect(result.data.state.genre).toBeUndefined();
    for (const u of calls(mock).filter((u) => !u.pathname.endsWith('/genres'))) {
      expect(u.searchParams.has('genre')).toBe(false);
    }
    // A known genre needs no lookup; a genre only the API lists is kept.
    const listed = api({
      ...okRoutes,
      '/books/genres': () =>
        json({ genres: [...facets.genres, { genre: 'Mystery', bookCount: 1 }] }),
    });
    const mystery = await searchLoader(args('/kerko?q=han&genre=Mystery'));
    expect(mystery.data.state.genre).toBe('Mystery');
    const books = calls(listed).find((u) => u.pathname.endsWith('/books'));
    expect(books?.searchParams.get('genre')).toBe('Mystery');
  });

  it('an API-listed non-ASCII genre page renders and is queried as-is', async () => {
    const mock = api({
      ...okRoutes,
      '/books/genres': () =>
        json({ genres: [...facets.genres, { genre: 'Letërsi', bookCount: 2 }] }),
    });
    const result = await exploreLoader(args('/eksploro/Let%C3%ABrsi', { genre: 'Letërsi' }));
    expect(result.data.state.genre).toBe('Letërsi');
    expect(result.data.title).toBe('Letërsi');
    expect(result.data.canonical).toBe('http://localhost:5174/eksploro/Let%C3%ABrsi');
    const books = calls(mock).find((u) => u.pathname.endsWith('/books'));
    expect(books?.searchParams.get('genre')).toBe('Letërsi');
    renderPage(result.data, '/eksploro/Let%C3%ABrsi');
    expect(await screen.findByRole('heading', { level: 1, name: 'Letërsi' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Letërsi/ })).toHaveAttribute(
      'href',
      '/eksploro/Let%C3%ABrsi',
    );
  });

  it('an unknown path genre is a 404 before any catalogue call', async () => {
    const mock = api(okRoutes);
    await expect(exploreLoader(args('/eksploro/Xyz', { genre: 'Xyz' }))).rejects.toMatchObject({
      status: 404,
    });
    expect(calls(mock).map((u) => u.pathname)).toEqual(['/api/v1/books/genres']);
  });
});

describe('Explore count route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cleans junk the same way as the page and returns the total', async () => {
    const mock = api({ '/books/facets': () => json({ ...facets, total: 7 }) });
    const response = await countLoader(
      args(
        `/eksploro/numero?genre=Fiction&page=-3&sort=evil&maxPrice=abc&publisherId=not-a-uuid&publisherId=${P1}&hideOwned=true&q=${'x'.repeat(250)}`,
      ),
    );
    expect(await response.json()).toEqual({ total: 7 });
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const [facetsCall] = calls(mock);
    expect(facetsCall.pathname).toBe('/api/v1/books/facets');
    expect(facetsCall.searchParams.get('genre')).toBe('Fiction');
    expect(facetsCall.searchParams.getAll('publisherId')).toEqual([P1]);
    expect(facetsCall.searchParams.get('search')).toHaveLength(200);
    for (const key of ['maxPrice', 'hideOwned', 'sort', 'page', 'limit']) {
      expect(facetsCall.searchParams.has(key)).toBe(false);
    }
  });

  it('validates the genre like the page: an unlisted genre is dropped, a listed one kept', async () => {
    const mock = api({
      '/books/facets': () => json({ ...facets, total: 3 }),
      '/books/genres': () =>
        json({ genres: [...facets.genres, { genre: 'Sci-Fi', bookCount: 3 }] }),
    });
    const unknown = await countLoader(args('/eksploro/numero?genre=Nope'));
    expect(await unknown.json()).toEqual({ total: 3 });
    const listed = await countLoader(args('/eksploro/numero?genre=Sci-Fi'));
    expect(await listed.json()).toEqual({ total: 3 });
    const facetCalls = calls(mock).filter((u) => u.pathname.endsWith('/facets'));
    expect(facetCalls.map((u) => u.searchParams.get('genre'))).toEqual([null, 'Sci-Fi']);
  });

  it('answers total: null when the API fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const response = await countLoader(args('/eksploro/numero?genre=Fiction'));
    expect(await response.json()).toEqual({ total: null });
  });
});

describe('FilterSheet', () => {
  it('opens on the current state, re-counts, submits the draft and resets on reopen', async () => {
    let release: (total: number) => void = () => {};
    const counted: URL[] = [];
    const Stub = createRoutesStub([
      {
        path: '/eksploro/numero',
        loader: async ({ request }) => {
          counted.push(new URL(request.url));
          const total = await new Promise<number>((resolve) => (release = resolve));
          return { total };
        },
      },
      {
        path: '/eksploro/:genre',
        loader: ({ request }) => {
          const url = new URL(request.url);
          return pageData({ state: parseExploreParams(url, { genre: 'Fiction' }) });
        },
        Component: ExplorePage,
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={['/eksploro/Fiction?maxPrice=1000']} />
      </I18nextProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Filtrat · 1' }));
    let sheet = await screen.findByRole('dialog', { name: 'Filtrat' });
    expect(within(sheet).getByRole('radio', { name: /Deri në 10/ })).toBeChecked();
    const show = () => screen.getByRole('button', { name: /^Shfaq/ });
    expect(show()).toHaveTextContent('Shfaq 18 libra');

    // A change: no stale number while the count is in flight, then the fetched total.
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Çdo çmim' }));
    await waitFor(() => expect(counted).toHaveLength(1));
    expect(show()).toHaveTextContent('Shfaq librat');
    expect(counted[0].searchParams.get('genre')).toBe('Fiction');
    expect(counted[0].searchParams.has('maxPrice')).toBe(false);
    release(7);
    await waitFor(() => expect(show()).toHaveTextContent('Shfaq 7 libra'));

    // Submitting goes to the draft's URL: the price filter is gone.
    fireEvent.click(show());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('button', { name: 'Filtrat' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Filtrat aktivë' })).not.toBeInTheDocument();

    // Choices left unsubmitted are forgotten: reopening starts from the page again.
    fireEvent.click(screen.getByRole('button', { name: 'Filtrat' }));
    sheet = await screen.findByRole('dialog', { name: 'Filtrat' });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Këtë vit' }));
    expect(within(sheet).getByRole('radio', { name: 'Këtë vit' })).toBeChecked();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mbyll' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Filtrat' }));
    sheet = await screen.findByRole('dialog', { name: 'Filtrat' });
    expect(within(sheet).getByRole('radio', { name: 'Këtë vit' })).not.toBeChecked();
    expect(within(sheet).getByRole('radio', { name: 'Çdo kohë' })).toBeChecked();
    expect(show()).toHaveTextContent('Shfaq 18 libra');
  });
});
