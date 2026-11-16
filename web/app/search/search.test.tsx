import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { createI18n } from '../i18n';
import type { StoreBook, Suggestions } from '../lib/types';
import { loader } from '../routes/suggest';
import { recentSearches } from './recent-searches';
import { SearchBox } from './SearchBox';

const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const book: StoreBook = {
  id: 'b1',
  title: 'Zonja e Hanit të Bardhë',
  author: 'Leart Osmani',
  isbn13: null,
  description: null,
  genre: 'Fiction',
  language: 'sq',
  price: { amountCents: 599, currency: 'EUR' },
  coverImageUrl: '/api/v1/books/b1/cover?v=1',
  publishedAt: null,
  publisher: { id: 'p1', name: 'Kodra e Blertë' },
  forSale: true,
  mediaType: 'ebook',
  durationSeconds: null,
};

const suggestions: Suggestions = {
  titles: [book],
  authors: [{ name: 'Hana Shkurti', bookCount: 1, mainGenre: 'Poetry' }],
  publishers: [{ id: 'p9', name: 'Hanbooks', bookCount: 4 }],
};

const requests: string[] = [];

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

function Home() {
  return (
    <main>
      <SearchBox />
      <Where />
    </main>
  );
}

function setup(data: Suggestions | ((q: string) => Promise<Suggestions>) = suggestions) {
  const Stub = createRoutesStub([
    {
      path: '/',
      Component: Home,
    },
    {
      path: '/kerko/sugjerime',
      loader: async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        requests.push(q);
        return typeof data === 'function' ? data(q) : structuredClone(data);
      },
    },
    { path: '/kerko', Component: Home },
    { path: '/botues/:id', Component: Home },
    { path: '/libri/:id/:slug', Component: Where },
  ]);
  render(
    <I18nextProvider i18n={createI18n('sq')}>
      <Stub initialEntries={['/']} />
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const input = () => screen.getByRole('combobox');

beforeEach(() => {
  requests.length = 0;
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe('SearchBox', () => {
  it('makes no request below 2 characters', async () => {
    const user = setup();
    await user.type(input(), 'h');
    await new Promise((r) => setTimeout(r, 350));
    expect(requests).toEqual([]);
    expect(input()).toHaveAttribute('aria-expanded', 'false');
  });

  it('debounces quick typing into one request', async () => {
    const user = setup();
    await user.type(input(), 'han');
    await screen.findByRole('listbox');
    expect(requests).toEqual(['han']);
  });

  it('moves aria-activedescendant with the arrow keys', async () => {
    const user = setup();
    await user.type(input(), 'han');
    await screen.findByRole('listbox');
    expect(input()).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(input()).toHaveAttribute('aria-activedescendant', options[0]?.id);
    await user.keyboard('{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', options[1]?.id);
    await user.keyboard('{ArrowUp}');
    expect(input()).toHaveAttribute('aria-activedescendant', options[0]?.id);
  });

  it('Enter without an active option goes to /kerko?q=han and remembers it', async () => {
    const user = setup();
    await user.type(input(), 'han{Enter}');
    expect(await screen.findByTestId('where')).toHaveTextContent('/kerko?q=han');
    expect(recentSearches.read()).toEqual(['han']);
  });

  it('Enter on an active option opens it', async () => {
    const user = setup();
    await user.type(input(), 'han');
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByTestId('where')).toHaveTextContent(
      '/libri/b1/zonja-e-hanit-te-bardhe',
    );
  });

  it('routes author and publisher options', async () => {
    const user = setup();
    await user.type(input(), 'han');
    await user.click(await screen.findByRole('option', { name: /Hana Shkurti/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/kerko?q=Hana%20Shkurti');
    await user.clear(input());
    await user.type(input(), 'han');
    await user.click(await screen.findByRole('option', { name: /Hanbooks/ }));
    expect(await screen.findByTestId('where')).toHaveTextContent('/botues/p9');
  });

  it('Escape closes the list and keeps focus in the input', async () => {
    const user = setup();
    await user.type(input(), 'han');
    await screen.findByRole('listbox');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(input()).toHaveFocus();
  });

  it('highlights the match ignoring case and diacritics, keeping the original characters', async () => {
    const user = setup();
    await user.type(input(), 'han');
    const option = await screen.findByRole('option', { name: /Zonja e Hanit/ });
    const mark = option.querySelector('mark');
    expect(mark).toHaveTextContent('Han');
    await user.clear(input());
    await user.type(input(), 'bardhe');
    await waitFor(() => expect(requests).toContain('bardhe'));
    const again = await screen.findByRole('option', { name: /Zonja e Hanit/ });
    expect(again.querySelector('mark')).toHaveTextContent('Bardhë');
  });

  it('shows the footer row with the query', async () => {
    const user = setup();
    await user.type(input(), 'han');
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox).getByRole('option', { name: /Shiko të gjitha rezultatet për "han"/ }),
    ).toBeVisible();
  });

  it('ignores a superseded response', async () => {
    const user = setup(async (q) => {
      if (q === 'ha') await new Promise((r) => setTimeout(r, 400));
      return q === 'ha'
        ? {
            titles: [],
            authors: [{ name: 'Stale Name', bookCount: 1, mainGenre: 'x' }],
            publishers: [],
          }
        : suggestions;
    });
    await user.type(input(), 'ha');
    await waitFor(() => expect(requests).toEqual(['ha']));
    await user.type(input(), 'n');
    await screen.findByRole('option', { name: /Hana Shkurti/ });
    await new Promise((r) => setTimeout(r, 500));
    expect(screen.queryByText('Stale Name')).toBeNull();
  });

  it('keeps the last results open while the next query loads, then replaces them', async () => {
    let release: () => void = () => {};
    const user = setup(async (q) => {
      if (q === 'hana') await new Promise<void>((r) => (release = r));
      return q === 'hana'
        ? {
            titles: [],
            authors: [{ name: 'Hana Fresh', bookCount: 1, mainGenre: 'Poetry' }],
            publishers: [],
          }
        : suggestions;
    });
    await user.type(input(), 'han');
    await screen.findByRole('option', { name: /Hana Shkurti/ });
    await user.type(input(), 'a');
    await waitFor(() => expect(requests).toContain('hana'));
    // Loading "hana": the popover stays open with the "han" results, highlighted for "hana"…
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    const kept = screen.getByRole('option', { name: /Hana Shkurti/ });
    expect(kept.querySelector('mark')).toHaveTextContent('Hana');
    // …and the footer row already searches for the current query.
    expect(
      screen.getByRole('option', { name: /Shiko të gjitha rezultatet për "hana"/ }),
    ).toBeVisible();
    release();
    await screen.findByRole('option', { name: /Hana Fresh/ });
    expect(screen.queryByRole('option', { name: /Hana Shkurti/ })).toBeNull();
  });

  it('shows recent searches when focused and empty, and removes one', async () => {
    recentSearches.add('poezi deti');
    const user = setup();
    await user.click(input());
    expect(await screen.findByText('Kërkimet e fundit')).toBeVisible();
    expect(screen.getByRole('option', { name: 'poezi deti' })).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Hiq "poezi deti" nga kërkimet e fundit' }),
    );
    expect(recentSearches.read()).toEqual([]);
    expect(screen.queryByRole('option', { name: 'poezi deti' })).toBeNull();
  });

  it('Delete removes the active recent and the hint is tied to the input', async () => {
    recentSearches.add('poezi deti');
    recentSearches.add('ese');
    const user = setup();
    await user.click(input());
    const hint = input().getAttribute('aria-describedby');
    expect(document.getElementById(hint as string)).toHaveTextContent(
      'Shtyp Delete për ta hequr një kërkim të fundit',
    );
    await user.keyboard('{ArrowDown}{Delete}');
    expect(recentSearches.read()).toEqual(['poezi deti']);
    expect(screen.queryByRole('option', { name: 'ese' })).toBeNull();
  });

  it('Delete edits text when no recent is active, and the hint is absent while searching', async () => {
    recentSearches.add('ese');
    const user = setup();
    await user.click(input());
    await user.keyboard('ab{ArrowLeft}{Delete}');
    expect(input()).toHaveValue('a');
    expect(recentSearches.read()).toEqual(['ese']);
    await user.type(input(), 'n');
    await screen.findByRole('listbox');
    expect(input()).not.toHaveAttribute('aria-describedby');
  });

  it('never shows the previous query results after dropping under 2 characters and back', async () => {
    const user = setup(async (q) =>
      q === 'han'
        ? suggestions
        : {
            titles: [],
            authors: [{ name: 'Other Name', bookCount: 1, mainGenre: 'x' }],
            publishers: [],
          },
    );
    await user.type(input(), 'han');
    await screen.findByRole('option', { name: /Hana Shkurti/ });
    await user.clear(input());
    await user.type(input(), 'zz');
    expect(screen.queryByRole('option', { name: /Hana Shkurti/ })).toBeNull();
    await screen.findByRole('option', { name: /Other Name/ });
    expect(screen.queryByRole('option', { name: /Hana Shkurti/ })).toBeNull();
  });

  it('renders and works when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = setup();
    await user.click(input());
    await user.type(input(), 'han{Enter}');
    expect(await screen.findByTestId('where')).toHaveTextContent('/kerko?q=han');
  });

  it('open listbox passes axe', async () => {
    const user = setup();
    await user.type(input(), 'han');
    await screen.findByRole('listbox');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('open recent list passes axe', async () => {
    recentSearches.add('poezi');
    const user = setup();
    await user.click(input());
    await screen.findByRole('listbox');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('recentSearches', () => {
  it('dedupes case-insensitively, keeps 5 newest first', () => {
    for (const q of ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'B2']) recentSearches.add(q);
    expect(recentSearches.read()).toEqual(['B2', 'f6', 'e5', 'd4', 'c3']);
    recentSearches.remove('f6');
    expect(recentSearches.read()).toEqual(['B2', 'e5', 'd4', 'c3']);
  });

  it('falls back to [] on corrupt data', () => {
    localStorage.setItem('libraria.recentSearches', '{oops');
    expect(recentSearches.read()).toEqual([]);
  });
});

describe('suggest route', () => {
  const run = (q: string | null) =>
    loader({
      request: new Request(
        `http://localhost:5174/kerko/sugjerime${q === null ? '' : `?q=${encodeURIComponent(q)}`}`,
      ),
      params: {},
      context: {},
    } as unknown as Parameters<typeof loader>[0]);

  afterEach(() => vi.unstubAllGlobals());

  it('returns empty groups without calling the API under 2 chars', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const q of [null, '', ' a ']) {
      const res = await run(q);
      expect(await res.json()).toEqual({ titles: [], authors: [], publishers: [] });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('clamps q to 100 chars and returns the API data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(suggestions));
    vi.stubGlobal('fetch', fetchMock);
    const res = await run('x'.repeat(150));
    expect(await res.json()).toEqual(suggestions);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(`/search/suggest?q=${'x'.repeat(100)}`);
    expect(url).not.toContain('x'.repeat(101));
  });

  it('answers empty groups with 200 on API error and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));
    const res = await run('han');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ titles: [], authors: [], publishers: [] });
    expect(log).toHaveBeenCalled();
  });
});
