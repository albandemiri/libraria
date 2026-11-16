import { render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, Meta } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { createI18n } from '../i18n';
import type { BookDetail, StoreBook, Viewer } from '../lib/types';
import { loader as bookLoader } from '../routes/book';
import { type BookPageData, BookPage } from './BookPage';
import { purchaseState } from './purchase-state';
import { bookMeta } from './seo';

// jsdom cannot compute colours; contrast is checked in the design package.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const ID = '15459259-2a29-5a98-87aa-5f467426529a';
const PUB = '3179c2d0-524d-5ac4-b884-025de7590087';
const PATH = `/libri/${ID}/zonja-e-hanit-te-bardhe`;

function detail(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: ID,
    title: 'Zonja e Hanit të Bardhë',
    author: 'Leart Osmani',
    isbn13: '9780000000095',
    description: 'Paragrafi i parë.\n\nParagrafi i dytë.',
    genre: 'Fiction',
    language: 'sq',
    price: { amountCents: 599, currency: 'EUR' },
    coverImageUrl: `/api/v1/books/${ID}/cover?v=1`,
    publishedAt: '2026-11-02T00:00:00.000Z',
    publisher: { id: PUB, name: 'Pema e Kuqe Botime' },
    forSale: true,
    mediaType: 'ebook',
    durationSeconds: null,
    pageCount: 240,
    availability: 'on_sale',
    ...overrides,
  };
}

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    owned: false,
    acquiredAt: null,
    progress: null,
    refund: null,
    pendingTransactionId: null,
    ...overrides,
  };
}

function storeBook(id: string, overrides: Partial<StoreBook> = {}): StoreBook {
  return {
    id,
    title: `Libri ${id}`,
    author: `Autori ${id}`,
    isbn13: null,
    description: null,
    genre: 'Fiction',
    language: 'sq',
    price: { amountCents: 699, currency: 'EUR' },
    coverImageUrl: `/api/v1/books/${id}/cover?v=1`,
    publishedAt: '2026-10-01T00:00:00.000Z',
    publisher: { id: PUB, name: 'Pema e Kuqe Botime' },
    forSale: true,
    mediaType: 'ebook',
    durationSeconds: null,
    ...overrides,
  };
}

function pageData(overrides: Partial<BookPageData> = {}): BookPageData {
  return {
    lang: 'sq',
    book: detail(),
    viewer: null,
    path: PATH,
    origin: 'http://localhost:5174',
    shelves: { publisher: [storeBook('p1')], similar: [storeBook('s1')], author: [] },
    ...overrides,
  };
}

/** The page with React Router's <Meta>, as the root layout renders it. */
function PageWithMeta() {
  return (
    <>
      <Meta />
      <BookPage />
    </>
  );
}

function renderPage(data: BookPageData) {
  const Stub = createRoutesStub([
    { path: '/libri/:id/:slug?', loader: () => data, Component: BookPage },
  ]);
  return render(
    <I18nextProvider i18n={createI18n(data.lang)}>
      <Stub initialEntries={[data.path]} />
    </I18nextProvider>,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Handler = (url: URL) => Response;

/** A fetch mock that answers each API path; unknown paths fail the test loudly. */
function api(routes: Record<string, Handler>) {
  const mock = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/api/v1', '');
    const handler = routes[path];
    if (!handler) throw new Error(`unexpected API call ${url}`);
    return handler(url);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const page = (books: StoreBook[]) =>
  json({ books, pagination: { page: 1, limit: 7, total: books.length, totalPages: 1 } });

// biome-ignore lint/suspicious/noExplicitAny: the loader only reads request and params
const args = (path: string, params: Record<string, string | undefined>): any => ({
  request: new Request(`http://localhost:5174${path}`),
  params,
  context: {},
});

/** The Response a loader threw (a redirect or an error status). */
const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected the loader to throw');
    },
    (r: Response) => r,
  );

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('purchaseState', () => {
  it.each([
    [{ availability: 'taken_down' }, { owned: true }, 'owned_taken_down'],
    [{}, { owned: true }, 'owned'],
    [{}, { owned: false, pendingTransactionId: 't1' }, 'pending'],
    [{ forSale: false }, { owned: false }, 'not_for_sale'],
    [
      {},
      { owned: false, refund: { purchasedAt: '2026-09-03', refundedAt: '2026-09-05' } },
      'refunded',
    ],
    [{}, { owned: false }, 'can_buy'],
    [{}, undefined, 'guest_can_buy'],
  ] as const)('purchaseState %#', (book, v, expected) => {
    expect(purchaseState(detail(book as Partial<BookDetail>), v ? viewer(v) : undefined)).toBe(
      expected,
    );
  });

  it('an archived book is not for sale to a non-owner', () => {
    expect(purchaseState(detail({ availability: 'archived' }), viewer())).toBe('not_for_sale');
  });
});

describe('book loader', () => {
  const okRoutes: Record<string, Handler> = {
    [`/books/${ID}`]: () => json({ book: detail() }),
    '/books': () => page([]),
  };

  it('redirects a wrong slug to the canonical URL with 301', async () => {
    api(okRoutes);
    const wrong = await rejected(
      bookLoader(args(`/libri/${ID}/gabim?ref=x`, { id: ID, slug: 'gabim' })),
    );
    expect(wrong.status).toBe(301);
    expect(wrong.headers.get('Location')).toBe(`${PATH}?ref=x`);

    const missing = await rejected(bookLoader(args(`/libri/${ID}`, { id: ID })));
    expect(missing.status).toBe(301);
    expect(missing.headers.get('Location')).toBe(PATH);
  });

  it('an unknown book is a 404, and a malformed id never reaches the API', async () => {
    api({
      ...okRoutes,
      [`/books/${ID}`]: () => json({ error: { code: 'NOT_FOUND', message: 'no' } }, 404),
    });
    await expect(bookLoader(args(PATH, { id: ID, slug: 'x' }))).rejects.toMatchObject({
      status: 404,
    });
    const mock = api(okRoutes);
    await expect(bookLoader(args('/libri/abc', { id: 'abc' }))).rejects.toMatchObject({
      status: 404,
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('fetches the three shelves in parallel, dropping this book and keeping six', async () => {
    const seven = (prefix: string) =>
      Array.from({ length: 7 }, (_, i) => storeBook(`${prefix}${i}`));
    const mock = api({
      ...okRoutes,
      '/books': (url) => {
        if (url.searchParams.get('publisherId') === PUB)
          return page([storeBook(ID), ...seven('p').slice(0, 6)]);
        if (url.searchParams.get('genre') === 'Fiction') return page(seven('s'));
        return page([storeBook(ID, { author: 'Leart Osmani' })]);
      },
    });
    const result = await bookLoader(args(PATH, { id: ID, slug: 'zonja-e-hanit-te-bardhe' }));
    const shelves = result.data.shelves;
    expect(shelves.publisher.map((b: StoreBook) => b.id)).toEqual([
      'p0',
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
    ]);
    expect(shelves.similar).toHaveLength(6);
    const queries = mock.mock.calls
      .map(([u]) => new URL(String(u)))
      .filter((u) => u.pathname.endsWith('/books'));
    expect(queries.map((u) => u.searchParams.get('limit'))).toEqual(['7', '7', '7']);
    expect(queries.some((u) => u.searchParams.get('search') === 'Leart Osmani')).toBe(true);
  });

  it('more-by-author shelf hidden when the author has one book', async () => {
    api({
      ...okRoutes,
      '/books': (url) =>
        url.searchParams.get('search')
          ? // A namesake match is not the same author.
            page([
              storeBook(ID, { author: 'Leart Osmani' }),
              storeBook('x', { author: 'Leart Osmani Jr.' }),
            ])
          : page([]),
    });
    const result = await bookLoader(args(PATH, { id: ID, slug: 'zonja-e-hanit-te-bardhe' }));
    expect(result.data.shelves.author).toEqual([]);
    renderPage(result.data);
    await screen.findByRole('heading', { level: 1, name: 'Zonja e Hanit të Bardhë' });
    expect(screen.queryByRole('heading', { name: /Më shumë nga/ })).not.toBeInTheDocument();
  });

  it('shows the author shelf with two or more exact matches; a failed shelf is skipped', async () => {
    api({
      ...okRoutes,
      '/books': (url) => {
        if (url.searchParams.get('genre')) return json({ error: { code: 'X', message: 'x' } }, 500);
        if (url.searchParams.get('search'))
          return page([
            storeBook(ID, { author: 'Leart Osmani' }),
            storeBook('a2', { author: 'Leart Osmani' }),
          ]);
        return page([storeBook('p1')]);
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await bookLoader(args(PATH, { id: ID, slug: 'zonja-e-hanit-te-bardhe' }));
    expect(result.data.shelves.author.map((b: StoreBook) => b.id)).toEqual(['a2']);
    expect(result.data.shelves.similar).toEqual([]);
    renderPage(result.data);
    expect(
      await screen.findByRole('heading', { name: 'Më shumë nga Leart Osmani' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Të ngjashme' })).not.toBeInTheDocument();
  });
});

describe('BookPage', () => {
  it('renders the hero, details, synopsis and shelves', async () => {
    renderPage(pageData());
    await screen.findByRole('heading', { level: 1, name: 'Zonja e Hanit të Bardhë' });
    expect(screen.getByRole('link', { name: 'Leart Osmani' })).toBeInTheDocument();
    const details = screen.getByTestId('book-details');
    expect(within(details).getByRole('link', { name: 'Pema e Kuqe Botime' })).toHaveAttribute(
      'href',
      `/botues/${PUB}`,
    );
    expect(details).toHaveTextContent('rreth 240 faqe');
    expect(details).toHaveTextContent('EPUB · e mbrojtur');
    expect(details).toHaveTextContent('978-0-00-000009-5');
    expect(details).toHaveTextContent('Shqip');
    expect(screen.getByRole('heading', { name: 'Rreth librit' })).toBeInTheDocument();
    // The first paragraph is the pull quote; the synopsis carries only the rest.
    const synopsis = screen.getByTestId('synopsis');
    expect(within(synopsis).getAllByText(/Paragrafi/)).toHaveLength(1);
    expect(within(synopsis).getByText('Paragrafi i dytë.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Nga e njëjta shtëpi botuese' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Të ngjashme' })).toBeInTheDocument();
    expect(screen.getByText(/Lexoje kudo\./)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Në shfletues dhe në aplikacionin Libraria për iOS dhe Android, edhe pa internet\./,
      ),
    ).toBeInTheDocument();
  });

  it('renders without description, cover, pageCount or publishedAt and never prints null', async () => {
    const { container } = renderPage(
      pageData({
        book: detail({
          description: null,
          coverImageUrl: null,
          pageCount: null,
          publishedAt: null,
          isbn13: null,
        }),
        shelves: { publisher: [], similar: [], author: [] },
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Zonja e Hanit të Bardhë' });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('img', { name: /Zonja e Hanit të Bardhë/ })).toBeInTheDocument();
    // No pull quote; "Rreth librit" keeps its heading and tags only.
    const synopsis = screen.getByTestId('synopsis');
    expect(within(synopsis).getByRole('heading', { name: 'Rreth librit' })).toBeInTheDocument();
    expect(synopsis.querySelectorAll('p')).toHaveLength(0);
    expect(within(synopsis).getByRole('link', { name: 'Prozë' })).toBeInTheDocument();
    const details = screen.getByTestId('book-details');
    expect(details).not.toHaveTextContent('faqe');
    expect(details).not.toHaveTextContent('Botuar');
    expect(details).not.toHaveTextContent('ISBN');
    expect(container.textContent).not.toMatch(/null|undefined|NaN|Invalid Date/);
  });

  it('a one-paragraph description appears exactly once', async () => {
    const text = 'Një roman i qetë për njerëz të zakonshëm.';
    const { container } = renderPage(pageData({ book: detail({ description: text }) }));
    await screen.findByRole('heading', { level: 1, name: 'Zonja e Hanit të Bardhë' });
    expect(screen.getAllByText(text)).toHaveLength(1);
    expect(container.textContent?.split(text)).toHaveLength(2);
    const synopsis = screen.getByTestId('synopsis');
    expect(within(synopsis).queryByText(text)).not.toBeInTheDocument();
    expect(within(synopsis).getByRole('heading', { name: 'Rreth librit' })).toBeInTheDocument();
  });

  it('a long first paragraph is cut in the quote and shown in full in the synopsis', async () => {
    const long = `${'fjalë '.repeat(60).trim()} fundi.`;
    renderPage(pageData({ book: detail({ description: `${long}\n\nE dyta.` }) }));
    await screen.findByRole('heading', { level: 1, name: 'Zonja e Hanit të Bardhë' });
    const synopsis = screen.getByTestId('synopsis');
    const paragraphs = Array.from(synopsis.querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs).toEqual([long, 'E dyta.']);
    const quote = screen.getByText(
      (_, el) => el?.tagName === 'P' && /…$/.test(el.textContent ?? ''),
    );
    expect(quote.textContent?.length).toBeLessThanOrEqual(241);
    expect(long.startsWith(quote.textContent?.slice(0, -1) ?? 'x')).toBe(true);
    expect(screen.queryAllByText(long)).toHaveLength(1);
  });

  it('a multi-paragraph description splits on blank lines', async () => {
    renderPage(
      pageData({ book: detail({ description: 'Një.\n\nDy.\n  \nTre.\nende tre.\n\n\n' }) }),
    );
    await screen.findByRole('heading', { level: 1, name: 'Zonja e Hanit të Bardhë' });
    const synopsis = screen.getByTestId('synopsis');
    const paragraphs = Array.from(synopsis.querySelectorAll('p')).map((p) => p.textContent);
    expect(paragraphs).toEqual(['Dy.', 'Tre.\nende tre.']);
    expect(within(synopsis).queryByText('Një.')).not.toBeInTheDocument();
    expect(screen.getAllByText('Një.')).toHaveLength(1);
  });

  it('a title with </script> is escaped in the JSON-LD', async () => {
    const data = pageData({ book: detail({ title: 'Libri</script><script>alert(1)</script>' }) });
    const Stub = createRoutesStub([
      {
        path: '/libri/:id/:slug?',
        loader: () => data,
        meta: () => bookMeta(data.book, data.origin, data.lang),
        Component: PageWithMeta,
      },
    ]);
    const { container } = render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={[data.path]} />
      </I18nextProvider>,
    );
    await screen.findByRole('heading', { level: 1 });
    const scripts = container.querySelectorAll('script');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toHaveAttribute('type', 'application/ld+json');
    expect(scripts[0].innerHTML).not.toContain('</script>');
    expect(JSON.parse(scripts[0].textContent ?? '').name).toBe(
      'Libri</script><script>alert(1)</script>',
    );
  });

  it('can_buy: price, VAT note and a POST form with intent=buy', async () => {
    const { container } = renderPage(pageData({ viewer: viewer() }));
    const button = await screen.findByRole('button', { name: 'Bli librin' });
    const form = button.closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form?.querySelector('input[name="intent"]')).toHaveValue('buy');
    expect(form?.querySelector('input[name="returnTo"]')).toHaveValue(PATH);
    expect(screen.getByText('TVSH e përfshirë')).toBeInTheDocument();
    expect(container.textContent).toMatch(/5,99/);
  });

  it('guest_can_buy: the button links to sign in and back', async () => {
    renderPage(pageData());
    const link = await screen.findByRole('link', { name: 'Bli librin' });
    expect(link).toHaveAttribute('href', `/hyr?returnTo=${encodeURIComponent(PATH)}`);
  });

  it('owned: date, progress and "Vazhdo leximin"; "Lexo tani" without progress', async () => {
    renderPage(
      pageData({
        viewer: viewer({
          owned: true,
          acquiredAt: '2026-10-14T09:00:00.000Z',
          progress: { percent: 42, chapterTitle: 'Kapitulli 7' },
        }),
      }),
    );
    expect(
      await screen.findByText('✓ Në bibliotekën tënde që nga 14 tetor 2026'),
    ).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText('42% · Kapitulli 7')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vazhdo leximin' })).toHaveAttribute(
      'href',
      `/lexo/${ID}`,
    );
    expect(screen.queryByRole('button', { name: 'Bli librin' })).not.toBeInTheDocument();
  });

  it('owned without progress reads "Lexo tani"; a chapter alone has no number', async () => {
    renderPage(pageData({ viewer: viewer({ owned: true, acquiredAt: '2026-10-14' }) }));
    expect(await screen.findByRole('link', { name: 'Lexo tani' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('owned with only a chapter shows the chapter without a percent', async () => {
    renderPage(
      pageData({
        viewer: viewer({
          owned: true,
          acquiredAt: null,
          progress: { percent: null, chapterTitle: 'Kapitulli 2' },
        }),
      }),
    );
    expect(await screen.findByText('Kapitulli 2')).toBeInTheDocument();
    expect(screen.getByText('✓ Në bibliotekën tënde')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vazhdo leximin' })).toBeInTheDocument();
  });

  it('owned_taken_down, not_for_sale, refunded and pending copy', async () => {
    const { unmount } = renderPage(
      pageData({ book: detail({ availability: 'taken_down' }), viewer: viewer({ owned: true }) }),
    );
    expect(
      await screen.findByText('Ky libër është hequr nga botuesi dhe nuk mund të lexohet më'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /Vazhdo leximin|Lexo tani/ }),
    ).not.toBeInTheDocument();
    unmount();

    const second = renderPage(
      pageData({ book: detail({ forSale: false, availability: 'not_for_sale' }) }),
    );
    expect(await screen.findByText('Përkohësisht nuk shitet')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bli librin' })).not.toBeInTheDocument();
    second.unmount();

    const third = renderPage(
      pageData({
        viewer: viewer({
          refund: { purchasedAt: '2026-09-03T10:00:00Z', refundedAt: '2026-09-05T10:00:00Z' },
        }),
      }),
    );
    expect(
      await screen.findByText(
        'Ke blerë këtë libër më 3 shtator 2026 dhe u rimbursove më 5 shtator 2026.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bli përsëri' }).closest('form')).toHaveAttribute(
      'method',
      'post',
    );
    third.unmount();

    renderPage(pageData({ viewer: viewer({ pendingTransactionId: 't1' }) }));
    expect(await screen.findByText('Pagesa po përpunohet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pagesë/i })).toHaveAttribute('href', '/pagesa/t1');
  });

  it('book page passes axe in can_buy and owned states', async () => {
    const first = renderPage(pageData({ viewer: viewer() }));
    await screen.findByRole('button', { name: 'Bli librin' });
    expect(await axe(first.container)).toHaveNoViolations();
    first.unmount();

    const owned = renderPage(
      pageData({
        viewer: viewer({
          owned: true,
          acquiredAt: '2026-10-14',
          progress: { percent: 42, chapterTitle: 'Kapitulli 7' },
        }),
      }),
    );
    await screen.findByRole('link', { name: 'Vazhdo leximin' });
    expect(await axe(owned.container)).toHaveNoViolations();
  });

  it('English copy', async () => {
    renderPage(pageData({ lang: 'en', viewer: viewer() }));
    expect(await screen.findByRole('button', { name: 'Buy the book' })).toBeInTheDocument();
    expect(screen.getByText('VAT included')).toBeInTheDocument();
  });
});
