import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { createI18n, type Lang } from '../i18n';
import type { DiscoverResponse, DiscoverSection, StoreBook } from '../lib/types';
import Discover, { loader, meta } from '../routes/discover';
import { DiscoverSections } from './DiscoverSections';
import { monogram } from './PublisherSpotlight';

// jsdom cannot compute colours; contrast is checked in the design package.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

function book(id: string, overrides: Partial<StoreBook> = {}): StoreBook {
  return {
    id,
    title: `Libri ${id}`,
    author: `Autori ${id}`,
    isbn13: null,
    description: `Përshkrimi i ${id}.`,
    genre: 'Fiction',
    language: 'sq',
    price: { amountCents: 599, currency: 'EUR' },
    coverImageUrl: `/api/v1/books/${id}/cover?v=1`,
    publishedAt: '2026-11-05T00:00:00.000Z',
    publisher: { id: 'p1', name: 'Pema e Kuqe Botime' },
    forSale: true,
    mediaType: 'ebook',
    durationSeconds: null,
    ...overrides,
  };
}

/** A fixed render time: relative dates never depend on the clock. */
const NOW = '2026-11-16T10:00:00.000Z';

const featured: DiscoverSection = {
  type: 'featured',
  book: book('f1', { title: 'Zonja e Hanit të Bardhë' }),
  related: book('r1', { title: 'Mbrëmje në Hanin e Gurit' }),
};

const all: DiscoverSection[] = [
  featured,
  {
    type: 'strip',
    items: [
      { label: 'new', book: book('s1') },
      { label: 'top_month', book: book('s2') },
      { label: 'genre', book: book('s3', { genre: 'Poetry' }) },
      { label: 'publisher', book: book('s4') },
    ],
  },
  {
    type: 'continue_reading',
    items: [
      { book: book('c1'), percent: 42, chapterTitle: 'Kapitulli 7', lastReadAt: '2026-11-15' },
      { book: book('c2'), percent: null, chapterTitle: null, lastReadAt: '2026-11-10' },
    ],
  },
  {
    type: 'new_releases',
    lead: book('n0'),
    books: [book('n1', { genre: 'History' }), book('n2'), book('n3'), book('n4')],
  },
  {
    type: 'most_read',
    since: '2026-10-17T00:00:00.000Z',
    books: [book('m1'), book('m2'), book('m3')],
  },
  {
    type: 'genres',
    genres: [
      { genre: 'Fiction', bookCount: 18, coverBookIds: ['a', 'b', 'c'] },
      { genre: 'Mystery', bookCount: 1, coverBookIds: ['d'] },
    ],
  },
  {
    type: 'publisher_spotlight',
    publisher: {
      id: 'p1',
      name: 'Pema e Kuqe Botime',
      country: 'AL',
      bookCount: 13,
      genres: ['Essays', 'Fiction'],
      newestYear: 2026,
    },
    books: [book('p1b1'), book('p1b2'), book('p1b3'), book('p1b4')],
  },
  { type: 'interlude', genre: 'Essays', bookCount: 8, books: [book('i1'), book('i2')] },
];

const issue: DiscoverResponse['issue'] = {
  isoYear: 2026,
  isoWeek: 47,
  date: '2026-11-16',
  bookCount: 62,
  publisherCount: 4,
};

// A data router, because the featured book's buy button is a router <Form>.
let current: ReactElement = <></>;
function Current() {
  return current;
}
const Stub = createRoutesStub([{ path: '/', Component: Current }]);

function wrap(ui: ReactElement, lang: Lang = 'sq') {
  current = ui;
  return render(
    <I18nextProvider i18n={createI18n(lang)}>
      <Stub initialEntries={['/']} />
    </I18nextProvider>,
  );
}

function sectionOrder(container: HTMLElement) {
  return [...container.querySelectorAll('[data-section]')].map((el) =>
    el.getAttribute('data-section'),
  );
}

describe('DiscoverSections', () => {
  it('renders sections in the order received', () => {
    const order = [all[7], all[0], all[3]];
    const { container } = wrap(<DiscoverSections now={NOW} sections={order} />);
    expect(sectionOrder(container)).toEqual(['interlude', 'featured', 'new_releases']);
  });

  it('skips an unknown section type without crashing', () => {
    const unknown = {
      type: 'collection',
      title: 'Koleksioni',
      books: [],
    } as unknown as DiscoverSection;
    const { container } = wrap(<DiscoverSections now={NOW} sections={[unknown, featured]} />);
    expect(sectionOrder(container)).toEqual(['featured']);
    expect(screen.getByRole('heading', { level: 2, name: /Zonja e Hanit/ })).toBeInTheDocument();
  });

  it('shows Lexo tani instead of Bli librin when the featured book is owned', () => {
    const owned: DiscoverSection = { ...featured, book: book('f1', { owned: true }) };
    wrap(<DiscoverSections now={NOW} sections={[owned]} />);
    expect(screen.getByRole('link', { name: 'Lexo tani' })).toHaveAttribute('href', '/lexo/f1');
    expect(screen.queryByRole('button', { name: 'Bli librin' })).toBeNull();
  });

  it('posts Bli librin to the book page buy action, returning to Discover', () => {
    const { container } = wrap(<DiscoverSections now={NOW} sections={[featured]} />);
    const button = screen.getByRole('button', { name: 'Bli librin' });
    const form = button.closest('form') as HTMLFormElement;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/libri/f1/zonja-e-hanit-te-bardhe');
    expect(container.querySelector('input[name="intent"]')).toHaveValue('buy');
    expect(container.querySelector('input[name="returnTo"]')).toHaveValue('/');
  });

  it('shows no buy button for a book that is temporarily not for sale', () => {
    const unpriced: DiscoverSection = { ...featured, book: book('f1', { forSale: false }) };
    wrap(<DiscoverSections now={NOW} sections={[unpriced]} />);
    expect(screen.queryByRole('button', { name: 'Bli librin' })).toBeNull();
    expect(screen.getAllByText('Përkohësisht nuk shitet').length).toBeGreaterThan(0);
  });

  it('sets the last word of the featured title in italic and names the related book', () => {
    wrap(<DiscoverSections now={NOW} sections={[featured]} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Zonja e Hanit të Bardhë' });
    expect(heading.querySelector('em')).toHaveTextContent('Bardhë');
    expect(screen.getByText('Mbrëmje në Hanin e Gurit')).toBeInTheDocument();
  });

  it('hides Vazhdo leximin when the section is absent', () => {
    const { unmount } = wrap(<DiscoverSections now={NOW} sections={all} />);
    expect(screen.getByRole('heading', { name: 'Vazhdo leximin' })).toBeInTheDocument();
    unmount();
    wrap(
      <DiscoverSections now={NOW} sections={all.filter((s) => s.type !== 'continue_reading')} />,
    );
    expect(screen.queryByRole('heading', { name: 'Vazhdo leximin' })).toBeNull();
  });

  it('shows reading progress and a link back into the book', () => {
    wrap(<DiscoverSections now={NOW} sections={[all[2]]} />);
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '42');
    expect(screen.getByText(/42% · Kapitulli 7/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Vazhdo/ })[0]).toHaveAttribute('href', '/lexo/c1');
  });

  it('says when a book was last read relative to the loader time, not the clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    try {
      wrap(<DiscoverSections now={NOW} sections={[all[2]]} />, 'en');
      // c2 has no chapter: 2026-11-10 is six days before NOW.
      expect(screen.getByText('6 days ago')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('translates genre names and falls back to the raw genre', () => {
    wrap(<DiscoverSections now={NOW} sections={[all[5]]} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Prozë' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Mystery' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Prozë/ })).toHaveAttribute(
      'href',
      '/eksploro/Fiction',
    );
  });

  it('uses id-only cover URLs for genre tiles', () => {
    const { container } = wrap(<DiscoverSections now={NOW} sections={[all[5]]} />);
    const srcs = [...container.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(srcs).toContain('/kopertina/a?size=thumb');
  });

  it('puts most read beside genre tiles when they are adjacent', () => {
    const { container } = wrap(<DiscoverSections now={NOW} sections={[all[4], all[5]]} />);
    const pair = container.querySelector('[data-pair]') as HTMLElement;
    expect(sectionOrder(pair)).toEqual(['most_read', 'genres']);
  });

  it('renders the publisher spotlight as the only dark band, with monogram and facts', () => {
    const { container } = wrap(<DiscoverSections now={NOW} sections={all} />);
    const dark = container.querySelectorAll('[data-dark]');
    expect(dark).toHaveLength(1);
    const band = dark[0] as HTMLElement;
    expect(band).toHaveAttribute('data-section', 'publisher_spotlight');
    expect(within(band).getByText('PK')).toBeInTheDocument();
    expect(within(band).getByText('13')).toBeInTheDocument();
    expect(within(band).getByRole('link', { name: /Katalogu i botuesit/ })).toHaveAttribute(
      'href',
      '/botues/p1',
    );
  });

  it('builds the monogram from the first two capitalised words', () => {
    expect(monogram('Pema e Kuqe Botime')).toBe('PK');
    expect(monogram('Shtëpia Botuese Ura')).toBe('SB');
    expect(monogram('Ëndrra')).toBe('Ë');
    expect(monogram('botime të reja')).toBe('BT');
  });

  it('speaks English', () => {
    wrap(<DiscoverSections now={NOW} sections={all} />, 'en');
    expect(screen.getByRole('button', { name: 'Buy the book' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New releases' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Fiction' })).toBeInTheDocument();
  });
});

describe('Discover route', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function renderRoute(
    data: { discover: DiscoverResponse | null; lang: Lang; now?: string },
    lang: Lang = 'sq',
  ) {
    const Stub = createRoutesStub([{ path: '/', loader: () => data, Component: Discover }]);
    return render(
      <I18nextProvider i18n={createI18n(lang)}>
        <Stub initialEntries={['/']} />
      </I18nextProvider>,
    );
  }

  it('the full page with every section passes axe', async () => {
    const { container } = renderRoute({ discover: { issue, sections: all }, lang: 'sq', now: NOW });
    await screen.findByRole('heading', { level: 1, name: 'Zbulo' });
    expect(container.textContent).toContain('Java 47 · 16 nëntor 2026');
    expect(container.textContent).toContain('62 libra · 4 botues');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows a calm error state with a retry link when the API is down', async () => {
    renderRoute({ discover: null, lang: 'sq' });
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Provo përsëri' })).toHaveAttribute('href', '/');
  });

  it('the loader returns the feed and the language', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ issue, sections: [featured] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    const request = new Request('http://localhost:5174/', {
      headers: { cookie: 'libraria_lang=en' },
    });
    // biome-ignore lint/suspicious/noExplicitAny: only the request is used
    const result = (await loader({ request, params: {}, context: {} } as any)) as any;
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/discover$/);
    expect(result.data).toEqual({
      discover: { issue, sections: [featured] },
      lang: 'en',
      now: '2026-11-16T10:00:00.000Z',
      // A fresh idempotency key per render for the masthead's "Bli librin".
      checkoutKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('the loader degrades to an error state when the API is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = new Request('http://localhost:5174/');
    // biome-ignore lint/suspicious/noExplicitAny: only the request is used
    const result = (await loader({ request, params: {}, context: {} } as any)) as any;
    expect(result.data).toEqual({ discover: null, lang: 'sq', now: expect.any(String) });
    expect(result.init?.status).toBe(503);
  });

  it('meta sets the title, description and og tags per language', () => {
    // biome-ignore lint/suspicious/noExplicitAny: only data is used
    const sq = meta({ data: { discover: null, lang: 'sq' } } as any) ?? [];
    expect(sq).toContainEqual({ title: 'Libraria — Zbulo' });
    expect(sq).toContainEqual({ property: 'og:title', content: 'Libraria — Zbulo' });
    expect(sq.some((m) => 'name' in m && m.name === 'description')).toBe(true);
    // biome-ignore lint/suspicious/noExplicitAny: only data is used
    const en = meta({ data: { discover: null, lang: 'en' } } as any) ?? [];
    expect(en).toContainEqual({ title: 'Libraria — Discover' });
  });
});
