import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import i18n from '../i18n';
import { formatMoney } from '../lib/format';
import BookEditorPage from './BookEditorPage';
import BookPage from './BookPage';
import CatalogPage from './CatalogPage';

expect.extend(axeMatchers);
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const scope = vi.hoisted(() => ({
  value: {
    publisherId: undefined as string | undefined,
    setPublisherId: () => undefined,
    isAdmin: false,
    publishers: [] as Array<{ id: string; name: string }>,
  },
}));
vi.mock('../layout/PublisherScope', () => ({ usePublisherScope: () => scope.value }));

type TestBook = Record<string, unknown>;

function makeBook(over: TestBook = {}): TestBook {
  return {
    id: 'b1',
    publisherId: 'p1',
    title: 'Draft Novel',
    author: 'A. Author',
    isbn13: '9781234567897',
    description: 'A story.',
    genre: 'Fiction',
    language: 'en',
    price: { amountCents: 1299, currency: 'EUR' },
    coverImageUrl: null,
    coverThumbUrl: null,
    publishedAt: null,
    isAvailable: false,
    mediaType: 'ebook',
    durationSeconds: null,
    status: 'draft',
    latestAsset: null,
    hasAsset: false,
    fileSizeBytes: null,
    metrics: { salesCount: 7, totalRevenueCents: 90_000, earningsCents: 34_567 },
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: 'x', requestId: 'r', details } });

const fetchMock = vi.fn();
let books: TestBook[];
let one: TestBook;
let assets: unknown[];
let publishResponse: () => Response;
let bookGet: (() => Response) | null;
let postDelay: number;
let patchResponse: (body: Record<string, unknown>) => Response;

const sale = {
  paidAt: '2026-11-02T10:00:00Z',
  transactionId: 'tx1',
  itemId: 'i1',
  refundedAt: null,
  book: { id: 'b1', title: 'Draft Novel' },
  country: 'AL',
  status: 'paid',
  unitPriceCents: 1299,
  taxCents: 100,
  feeCents: 50,
  commissionRateBps: 2000,
  commissionCents: 200,
  earningsCents: 949,
  commissionAtSaleCents: 200,
  commissionReversedCents: 0,
  earningsAtSaleCents: 949,
  earningsReversedCents: 0,
  refundedCents: 0,
  split: 'done',
};
const metrics = {
  grossCents: 5000,
  refundsCents: 0,
  taxCents: 0,
  feeCents: 0,
  netCents: 0,
  commissionAtSaleCents: 0,
  commissionReversedCents: 0,
  commissionCents: 0,
  unsplitCents: 0,
  earningsAtSaleCents: 0,
  earningsReversedCents: 0,
  earningsCents: 4321,
  copies: 3,
  refundedCopies: 0,
};

function route(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET';
  if (url.includes('/reports/sales')) {
    return json(200, {
      lines: [sale],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });
  }
  if (url.includes('/reports/summary')) {
    return json(200, { totals: metrics, series: [{ periodStart: '2026-11-01', ...metrics }] });
  }
  if (/\/books\/b1\/publish/.test(url)) return publishResponse();
  if (/\/books\/b1\/assets\/a1\/activate/.test(url)) return json(200, { asset: { id: 'a1' } });
  if (/\/books\/b1\/assets/.test(url)) {
    if (method === 'POST') return json(202, { asset: { id: 'a2' } });
    return json(200, { assets });
  }
  if (/\/publisher\/books\/b1/.test(url) && method === 'GET') {
    return bookGet ? bookGet() : json(200, { book: one });
  }
  if (/\/publisher\/books\/b1/.test(url) && method === 'PATCH') {
    return patchResponse(JSON.parse(String(init?.body)));
  }
  if (/\/publisher\/books(\?|$)/.test(url) && method === 'POST') {
    return json(201, { book: makeBook() });
  }
  if (/\/publisher\/books(\?|$)/.test(url)) {
    const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1');
    return json(200, {
      books: page > 1 ? [] : books,
      pagination: { page, limit: 20, total: books.length, totalPages: 1 },
    });
  }
  return apiError(404, 'NOT_FOUND');
}

const urls = () => fetchMock.mock.calls.map(([u]) => String(u));
const listUrls = () => urls().filter((u) => /\/publisher\/books\?/.test(u));

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Link to="/catalog">go catalog</Link>
          <Routes>
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/catalog/new" element={<BookEditorPage />} />
            <Route path="/catalog/:bookId/edit" element={<BookEditorPage />} />
            <Route path="/catalog/:bookId" element={<BookPage />} />
            <Route path="/catalog/:bookId/:tab" element={<BookPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  books = [makeBook()];
  one = makeBook();
  assets = [];
  publishResponse = () => apiError(400, 'ASSET_REQUIRED');
  bookGet = null;
  postDelay = 0;
  patchResponse = () => json(200, { book: one });
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (postDelay && init?.method === 'POST' && /\/publisher\/books(\?|$)/.test(String(url))) {
      await new Promise((resolve) => setTimeout(resolve, postDelay));
    }
    return route(String(url), init);
  });
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
/** Lets pending promises and short timers run, so a "nothing happened" check is deterministic. */
async function settle() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await act(() => vi.advanceTimersByTimeAsync(500));
  } finally {
    vi.useRealTimers();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CatalogPage', () => {
  it('shows each book as a card with price, copies and earnings from the backend', async () => {
    renderAt('/catalog');
    const title = await screen.findByText('Draft Novel');
    const card = title.closest('button') as HTMLElement;
    expect(within(card).getByText('Draft')).toBeInTheDocument();
    expect(within(card).getByText(formatMoney(1299, 'en'))).toBeInTheDocument();
    expect(within(card).getByText('7 copies')).toBeInTheDocument();
    expect(within(card).getByText(formatMoney(34_567, 'en'))).toBeInTheDocument();
  });

  it('opens the book page from a card', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await user.click(await screen.findByText('Draft Novel'));
    expect(screen.getByTestId('where')).toHaveTextContent('/catalog/b1');
  });

  it('uses the thumbnail for small covers when there is one', async () => {
    books = [makeBook({ coverImageUrl: '/full.jpg?v=1', coverThumbUrl: '/thumb.jpg?v=1' })];
    const { container } = renderAt('/catalog');
    await screen.findByText('Draft Novel');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/thumb.jpg?v=1');
  });

  it('falls back to the full cover when there is no thumbnail', async () => {
    books = [makeBook({ coverImageUrl: '/full.jpg', coverThumbUrl: null })];
    const { container } = renderAt('/catalog');
    await screen.findByText('Draft Novel');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/full.jpg');
  });

  it('remembers the grid or table choice', async () => {
    const user = userEvent.setup();
    const first = renderAt('/catalog');
    await screen.findByText('Draft Novel');
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Table' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('cell', { name: 'Draft' })).toBeInTheDocument();
    expect(within(table).getByText('9781234567897')).toBeInTheDocument();
    first.unmount();

    renderAt('/catalog');
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Table' })).toBeChecked();
  });

  it('still works when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    await user.click(screen.getByRole('radio', { name: 'Table' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('sends sort and order to the server', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'earnings');
    await waitFor(() =>
      expect(listUrls().some((u) => u.includes('sort=earnings') && u.includes('order=desc'))).toBe(
        true,
      ),
    );
    await user.selectOptions(screen.getByLabelText('Order'), 'asc');
    await waitFor(() =>
      expect(listUrls().some((u) => u.includes('sort=earnings') && u.includes('order=asc'))).toBe(
        true,
      ),
    );
  });

  it('sorts from a table header, server-side', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await user.click(await screen.findByRole('radio', { name: 'Table' }));
    await user.click(await screen.findByRole('button', { name: 'Title' }));
    await waitFor(() =>
      expect(listUrls().some((u) => u.includes('sort=title') && u.includes('order=asc'))).toBe(
        true,
      ),
    );
  });

  it('sends the status filter to the server and writes it to the URL', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    await user.selectOptions(screen.getByLabelText('Status'), 'processing');
    await waitFor(() => expect(listUrls().some((u) => u.includes('status=processing'))).toBe(true));
    expect(screen.getByTestId('where')).toHaveTextContent('status=processing');
  });

  it('reads status, search and sort from the URL, so links from Overview land filtered', async () => {
    renderAt('/catalog?status=draft&q=night&sort=price&order=asc');
    await screen.findByText('Draft Novel');
    const first = listUrls()[0] ?? '';
    expect(first).toContain('status=draft');
    expect(first).toContain('search=night');
    expect(first).toContain('sort=price');
    expect(first).toContain('order=asc');
    expect(screen.getByLabelText('Status')).toHaveValue('draft');
    expect(screen.getByRole('searchbox', { name: 'Search books' })).toHaveValue('night');
  });

  it('falls back to defaults for a garbage query string', async () => {
    renderAt('/catalog?status=nope&sort=wat&order=sideways&page=-3');
    await screen.findByText('Draft Novel');
    const first = listUrls()[0] ?? '';
    expect(first).toContain('status=all');
    expect(first).toContain('sort=updated');
    expect(first).toContain('order=desc');
    expect(first).toContain('page=1');
  });

  it('searches on the server after typing', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    await user.type(screen.getByRole('searchbox', { name: 'Search books' }), 'moby');
    await waitFor(() => expect(listUrls().some((u) => u.includes('search=moby'))).toBe(true));
    expect(screen.getByTestId('where')).toHaveTextContent('q=moby');
  });

  it('survives awkward data in both views: long title, no cover, no ISBN, no sales', async () => {
    const long = `L${'o'.repeat(299)}`;
    books = [
      makeBook({
        title: long,
        isbn13: null,
        coverImageUrl: null,
        author: 'Someone',
        metrics: { salesCount: 0, totalRevenueCents: 0, earningsCents: 0 },
      }),
    ];
    const user = userEvent.setup();
    renderAt('/catalog');
    const card = (await screen.findByText(long)).closest('button') as HTMLElement;
    // The typographic fallback cover shows the title's initial.
    expect(within(card).getByText('L')).toBeInTheDocument();
    expect(within(card).getByText('0 copies')).toBeInTheDocument();
    expect(within(card).getByText(formatMoney(0, 'en'))).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Table' }));
    const table = await screen.findByRole('table');
    const row = within(table).getByText(long).closest('tr') as HTMLElement;
    // The missing ISBN shows a dash rather than an empty cell.
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText('0')).toBeInTheDocument();
    expect(within(row).getByText('L')).toBeInTheDocument();
  });

  it('shows an empty state with a way to add the first book', async () => {
    books = [];
    renderAt('/catalog');
    expect(await screen.findByText('No books yet.')).toBeInTheDocument();
  });

  it('says when filters match nothing', async () => {
    books = [];
    renderAt('/catalog?status=withdrawn');
    expect(await screen.findByText('No books match these filters.')).toBeInTheDocument();
  });

  it('asks an admin to pick a publisher first', () => {
    scope.value = { ...scope.value, isAdmin: true };
    renderAt('/catalog');
    expect(
      screen.getByText('Choose a publisher in the sidebar to see its data.'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('has no axe violations in grid or table view', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/catalog');
    await screen.findByText('Draft Novel');
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole('radio', { name: 'Table' }));
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('BookPage', () => {
  it('shows the header and read-only details on the first tab', async () => {
    renderAt('/catalog/b1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Draft Novel' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details', selected: true })).toBeInTheDocument();
    expect(screen.getByText('9781234567897')).toBeInTheDocument();
    expect(screen.getByText('A story.')).toBeInTheDocument();
    expect(screen.getByText(formatMoney(1299, 'en'))).toBeInTheDocument();
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('shows dashes for missing metadata and the fallback cover', async () => {
    one = makeBook({ isbn13: null, description: null, title: 'Zebra' });
    renderAt('/catalog/b1');
    await screen.findByRole('heading', { level: 1, name: 'Zebra' });
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Z')).toBeInTheDocument();
  });

  it('opens the editor from Edit', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/catalog/b1/edit');
  });

  it('routes the tabs by URL and by click', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1/files');
    expect(await screen.findByRole('tab', { name: 'Files & DRM', selected: true })).toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Distribution' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/catalog/b1/distribution');
    await screen.findByRole('tab', { name: 'Distribution', selected: true });
    expect(
      await within(screen.getByRole('tabpanel')).findByRole('button', { name: 'Publish' }),
    ).toBeInTheDocument();
  });

  it('sends the book to the sales table', async () => {
    renderAt('/catalog/b1/sales');
    expect(await screen.findByText('Albania')).toBeInTheDocument();
    expect(urls().some((u) => u.includes('/reports/sales') && u.includes('bookId=b1'))).toBe(true);
    expect(screen.getByText(formatMoney(949, 'en'))).toBeInTheDocument();
  });

  it('asks the summary for this book only', async () => {
    renderAt('/catalog/b1/analytics');
    await waitFor(() =>
      expect(urls().some((u) => u.includes('/reports/summary') && u.includes('bookId=b1'))).toBe(
        true,
      ),
    );
    const table = await screen.findByRole('region', { name: 'Figures by period' });
    expect(within(table).getByText(formatMoney(4321, 'en'))).toBeInTheDocument();
  });

  it('uploads the raw EPUB from the Files tab', async () => {
    renderAt('/catalog/b1/files');
    const file = new File(['epub-bytes'], 'book.epub', { type: 'application/epub+zip' });
    await userEvent.upload(await screen.findByLabelText('Upload EPUB'), file);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([u, init]) => String(u).includes('/books/b1/assets') && init?.method === 'POST',
      );
      expect(post).toBeDefined();
      const init = post?.[1] as RequestInit;
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/epub+zip');
      expect(init.body).toBe(file);
    });
  });

  it('still confirms before making a version live', async () => {
    assets = [
      {
        id: 'a1',
        version: 1,
        state: 'ready',
        reasonCode: null,
        reasonDetail: null,
        originalSizeBytes: 2_500_000,
        isCurrent: false,
        createdAt: '2026-11-01T00:00:00Z',
        readyAt: '2026-11-01T00:01:00Z',
        activatedAt: null,
      },
    ];
    const user = userEvent.setup();
    renderAt('/catalog/b1/files');
    await user.click(await screen.findByRole('button', { name: 'Make this version live' }));
    expect(urls().some((u) => u.includes('/activate'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, make it live' }));
    await waitFor(() => expect(urls().some((u) => u.includes('/assets/a1/activate'))).toBe(true));
  });

  it('translates the ASSET_REQUIRED publish error', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1/distribution');
    await screen.findByRole('tab', { name: 'Distribution', selected: true });
    await user.click(
      await within(screen.getByRole('tabpanel')).findByRole('button', { name: 'Publish' }),
    );
    expect(await screen.findByText(/needs a ready, live EPUB file/)).toBeInTheDocument();
  });

  it('translates the withdrawn 403 publish error', async () => {
    publishResponse = () => apiError(403, 'FORBIDDEN');
    const user = userEvent.setup();
    renderAt('/catalog/b1/distribution');
    await screen.findByRole('tab', { name: 'Distribution', selected: true });
    await user.click(
      await within(screen.getByRole('tabpanel')).findByRole('button', { name: 'Publish' }),
    );
    expect(
      await screen.findByText(/has been withdrawn and cannot be published/),
    ).toBeInTheDocument();
    expect(screen.queryByText('x')).toBeNull();
  });

  it('shows the withdrawn notice and offers no publish action', async () => {
    one = makeBook({ status: 'withdrawn' });
    renderAt('/catalog/b1/distribution');
    expect(
      await screen.findByText(/has been withdrawn and cannot be published/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('offers Unpublish for a published book', async () => {
    one = makeBook({ status: 'published', isAvailable: true });
    renderAt('/catalog/b1/distribution');
    await screen.findByRole('tab', { name: 'Distribution', selected: true });
    expect(
      await within(screen.getByRole('tabpanel')).findByRole('button', { name: 'Unpublish' }),
    ).toBeInTheDocument();
  });

  it('sends the admin publisherId when publishing', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'p1' };
    const user = userEvent.setup();
    renderAt('/catalog/b1/distribution');
    await screen.findByRole('tab', { name: 'Distribution', selected: true });
    await user.click(
      await within(screen.getByRole('tabpanel')).findByRole('button', { name: 'Publish' }),
    );
    await waitFor(() =>
      expect(urls().some((u) => u.includes('/books/b1/publish?publisherId=p1'))).toBe(true),
    );
  });

  it('has no axe violations on the tabs', async () => {
    const user = userEvent.setup();
    const { container } = renderAt('/catalog/b1');
    await screen.findByRole('heading', { level: 1, name: 'Draft Novel' });
    expect(await axe(container)).toHaveNoViolations();
    for (const name of ['Sales', 'Analytics', 'Distribution', 'Files & DRM']) {
      await user.click(screen.getByRole('tab', { name }));
      await screen.findByRole('tab', { name, selected: true });
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
      expect(await axe(container)).toHaveNoViolations();
    }
  });
});

describe('BookEditorPage', () => {
  const stepState = (name: string) => {
    const item = screen
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes(name)) as HTMLElement;
    return within(item).queryByText('(completed)') !== null;
  };

  it('marks sections complete by the rules', async () => {
    one = makeBook({ hasAsset: true });
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    expect(stepState('Book information')).toBe(true);
    expect(stepState('Classification')).toBe(true);
    expect(stepState('Commercial')).toBe(true);
    expect(stepState('Publication files')).toBe(true);
    // Not published yet.
    expect(stepState('Distribution')).toBe(false);
  });

  it('marks nothing complete on a new book, then follows what is typed', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await screen.findByLabelText(/^Title/);
    for (const s of ['Book information', 'Commercial', 'Publication files', 'Distribution']) {
      expect(stepState(s)).toBe(false);
    }
    await user.type(screen.getByLabelText(/^Title/), 'T');
    expect(stepState('Book information')).toBe(false);
    await user.type(screen.getByLabelText(/^Author/), 'A');
    expect(stepState('Book information')).toBe(true);
    await user.type(screen.getByLabelText(/^Price/), '9,99');
    expect(stepState('Commercial')).toBe(true);
    expect(stepState('Classification')).toBe(false);
    await user.type(screen.getByLabelText(/^Genre/), 'Poetry');
    expect(stepState('Classification')).toBe(true);
  });

  it('offers Albanian and English as the book language, with Albanian preselected', async () => {
    renderAt('/catalog/new');
    const language = (await screen.findByLabelText(/^Language/)) as HTMLSelectElement;
    expect(language.tagName).toBe('SELECT');
    expect(language.value).toBe('sq');
    expect(
      within(language)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Albanian', 'English']);
  });

  it('keeps the saved language when editing an English book', async () => {
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    expect((screen.getByLabelText(/^Language/) as HTMLSelectElement).value).toBe('en');
  });

  it('marks Distribution complete for a published book', async () => {
    one = makeBook({ status: 'published', isAvailable: true, hasAsset: true });
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    expect(stepState('Distribution')).toBe(true);
  });

  it('has no Cover URL field, and the cover panel only exists once the draft does', async () => {
    const first = renderAt('/catalog/new');
    await screen.findByRole('heading', { name: 'New book' });
    expect(screen.queryByLabelText(/cover image url/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Upload cover')).not.toBeInTheDocument();
    first.unmount();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    expect(screen.queryByLabelText(/cover image url/i)).not.toBeInTheDocument();
    expect(await screen.findByLabelText('Upload cover')).toBeInTheDocument();
  });

  it('shows a live preview card', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    const preview = (await screen.findByRole('complementary')) as HTMLElement;
    expect(within(preview).getByText('Untitled book')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^Title/), 'Night Train');
    expect(within(preview).getByText('Night Train')).toBeInTheDocument();
  });

  it('flags missing required fields inline without sending anything', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await user.click(await screen.findByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Enter a title.')).toBeInTheDocument();
    expect(screen.getByText('Enter the author.')).toBeInTheDocument();
    expect(screen.getByText('Enter a genre.')).toBeInTheDocument();
    expect(screen.getByText('Enter a price like 9,99 or 9.99.')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('creates the draft first, then patches it on the next save', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await user.type(await screen.findByLabelText(/^Title/), 'Draft Novel');
    await user.type(screen.getByLabelText(/^Author/), 'A. Author');
    await user.type(screen.getByLabelText(/^Genre/), 'Fiction');
    await user.type(screen.getByLabelText(/^Price/), '12,99');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/catalog/b1/edit'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const created = JSON.parse(String(post?.[1]?.body));
    expect(created).toMatchObject({
      title: 'Draft Novel',
      author: 'A. Author',
      genre: 'Fiction',
      language: 'sq',
      priceCents: 1299,
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);

    await screen.findByText(/Draft saved/);
    await user.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true),
    );
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });

  it('offers the EPUB upload only once the draft exists', async () => {
    const first = renderAt('/catalog/new');
    await screen.findByLabelText(/^Title/);
    expect(screen.queryByLabelText('Upload EPUB')).toBeNull();
    expect(screen.getByText(/Save the draft first/)).toBeInTheDocument();
    first.unmount();
    renderAt('/catalog/b1/edit');
    expect(await screen.findByLabelText('Upload EPUB')).toBeInTheDocument();
  });

  it('shows validation details next to their field, in English', async () => {
    patchResponse = () =>
      apiError(400, 'VALIDATION_FAILED', [
        { path: 'isbn13', message: 'ISBN-13 must be exactly 13 numeric digits' },
      ]);
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(
      await screen.findByText('ISBN-13 must be 13 digits, with no hyphens.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/must be exactly/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^ISBN-13/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the Albanian field message, not the backend English', async () => {
    patchResponse = () =>
      apiError(400, 'VALIDATION_FAILED', [
        { path: 'isbn13', message: 'ISBN-13 must be exactly 13 numeric digits' },
      ]);
    await i18n.changeLanguage('sq');
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Ruaj draftin' }));
    expect(
      await screen.findByText('ISBN-13 duhet të ketë 13 shifra, pa viza.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/must be exactly/)).not.toBeInTheDocument();
  });

  it('sends null for cleared optional fields so the server clears them', async () => {
    one = makeBook({ isbn13: null, description: null });
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.isbn13).toBeNull();
    expect(body.description).toBeNull();
    // The cover is uploaded, not linked; the server refuses unknown keys.
    expect(body).not.toHaveProperty('coverImageUrl');
    expect(body.durationSeconds).toBeNull();
  });

  it('translates the ASSET_REQUIRED publish error in the distribution section', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/needs a ready, live EPUB file/)).toBeInTheDocument();
  });

  it('translates the withdrawn publish error', async () => {
    publishResponse = () => apiError(403, 'FORBIDDEN');
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(
      await screen.findByText(/has been withdrawn and cannot be published/),
    ).toBeInTheDocument();
  });

  it('explains that DRM is applied automatically', async () => {
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    expect(screen.getByText(/DRM is applied automatically/)).toBeInTheDocument();
  });

  it('sends the admin publisherId in the query for writes', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'p1' };
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(urls().some((u) => u.includes('/books/b1/publish?publisherId=p1'))).toBe(true),
    );
  });

  it('has no axe violations', async () => {
    const { container } = renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await screen.findByLabelText('Upload EPUB');
    expect(await axe(container)).toHaveNoViolations();
  });
});

const bookGets = () =>
  fetchMock.mock.calls.filter(
    ([u, init]) => /\/publisher\/books\/b1(\?|$)/.test(String(u)) && !init?.method,
  ).length;

describe('fix round 1: catalog', () => {
  it('clears the search box when the URL loses its query (link or Back)', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    const box = screen.getByRole('searchbox', { name: 'Search books' });
    await user.type(box, 'moby');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('q=moby'));
    await user.click(screen.getByRole('link', { name: 'go catalog' }));
    await waitFor(() => expect(screen.getByTestId('where')).not.toHaveTextContent('q='));
    expect(box).toHaveValue('');
  });

  it('sends no search param for a whitespace-only search', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    await user.type(screen.getByRole('searchbox', { name: 'Search books' }), '   ');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('q='));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await act(() => vi.advanceTimersByTimeAsync(400));
    vi.useRealTimers();
    expect(listUrls().some((u) => u.includes('search='))).toBe(false);
  });

  it('limits the search box to 200 characters', async () => {
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    expect(screen.getByRole('searchbox', { name: 'Search books' })).toHaveAttribute(
      'maxlength',
      '200',
    );
  });

  it('caps an absurd page number', async () => {
    renderAt('/catalog?page=99999999');
    await screen.findByRole('button', { name: 'Go to the last page' });
    expect(listUrls()[0]).toContain('page=10000');
  });

  it('offers a way back when the page is past the end, instead of "No books yet"', async () => {
    const user = userEvent.setup();
    renderAt('/catalog?page=999');
    expect(await screen.findByText(/catalog has fewer pages/)).toBeInTheDocument();
    expect(screen.queryByText('No books yet.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Go to the last page' }));
    expect(await screen.findByText('Draft Novel')).toBeInTheDocument();
    expect(screen.getByTestId('where')).not.toHaveTextContent('page=');
  });

  it('uses singular Albanian badge labels', () => {
    const sq = i18n.getFixedT('sq');
    expect(sq('catalog.status.published')).toBe('Publikuar');
    expect(sq('catalog.status.withdrawn')).toBe('Tërhequr');
    expect(sq('editor.steps.commercial')).toBe('Çmimi dhe shitja');
  });
});

describe('fix round 1: book page', () => {
  it('keeps the query string (the date range) when switching tabs', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1?from=2026-01-01&to=2026-02-01');
    await user.click(await screen.findByRole('tab', { name: 'Sales' }));
    const where = screen.getByTestId('where');
    expect(where).toHaveTextContent('/catalog/b1/sales');
    expect(where).toHaveTextContent('from=2026-01-01&to=2026-02-01');
  });

  it('refetches the book after an upload and when processing finishes', async () => {
    assets = [
      {
        id: 'a1',
        version: 1,
        state: 'scanning',
        reasonCode: null,
        reasonDetail: null,
        originalSizeBytes: 10,
        isCurrent: false,
        createdAt: '2026-11-01T00:00:00Z',
        readyAt: null,
        activatedAt: null,
      },
    ];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt('/catalog/b1/files');
    await screen.findByText('Scanning');
    await waitFor(() => expect(bookGets()).toBe(1));
    // Processing finishes: the poll sees every version settle and the book is refetched.
    assets = [{ ...(assets[0] as object), state: 'ready' }];
    await act(() => vi.advanceTimersByTimeAsync(3100));
    await waitFor(() => expect(bookGets()).toBeGreaterThan(1));
    // An upload also refetches it.
    const before = bookGets();
    await userEvent.upload(screen.getByLabelText('Upload EPUB'), new File(['x'], 'b.epub'));
    await waitFor(() => expect(bookGets()).toBeGreaterThan(before));
  });

  it('keeps what the editor typed when the book refetches on window focus', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    const title = await screen.findByLabelText(/^Title/);
    await user.clear(title);
    await user.type(title, 'My unsaved title');
    const before = bookGets();
    // The server's copy changed meanwhile; a focus refetch must not replace the typed text.
    one = makeBook({ title: 'Changed on the server' });
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(bookGets()).toBeGreaterThan(before));
    await settle();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('My unsaved title');
  });

  it('describes the upload control with its hint while its name stays "Upload EPUB"', async () => {
    renderAt('/catalog/b1/files');
    const input = await screen.findByLabelText('Upload EPUB');
    expect(input).toHaveAccessibleDescription(/100 MB/);
  });

  it('shows "not found" only for a 404; anything else is a retryable error', async () => {
    bookGet = () => apiError(500, 'INTERNAL_ERROR');
    const first = renderAt('/catalog/b1');
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('This book could not be found.')).toBeNull();
    first.unmount();
    bookGet = () => apiError(404, 'NOT_FOUND');
    renderAt('/catalog/b1');
    expect(await screen.findByText('This book could not be found.')).toBeInTheDocument();
  });
});

describe('fix round 1: editor', () => {
  async function fillNew(user: ReturnType<typeof userEvent.setup>, price: string) {
    await user.type(await screen.findByLabelText(/^Title/), 'Draft Novel');
    await user.type(screen.getByLabelText(/^Author/), 'A. Author');
    await user.type(screen.getByLabelText(/^Genre/), 'Fiction');
    if (price) await user.type(screen.getByLabelText(/^Price/), price);
  }
  const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

  it('creates exactly one book on a double-click of Save draft', async () => {
    postDelay = 60;
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await fillNew(user, '12,99');
    await user.dblClick(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/catalog/b1/edit'));
    expect(posts()).toHaveLength(1);
  });

  it.each([
    ['9,99', 999],
    ['0', 0],
  ])('accepts the price "%s" and sends %d cents', async (typed, cents) => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await fillNew(user, typed);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0]?.[1]?.body)).priceCents).toBe(cents);
  });

  it('rejects the price "abc" inline without sending', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await fillNew(user, 'abc');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Enter a price like 9,99 or 9.99.')).toBeInTheDocument();
    expect(posts()).toHaveLength(0);
  });

  it('moves focus to the first invalid field after a failed save', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await user.click(await screen.findByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(screen.getByLabelText(/^Title/)).toHaveFocus());
  });

  it('moves focus to the banner when the failure has no field', async () => {
    patchResponse = () => apiError(500, 'INTERNAL_ERROR');
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
  });

  it('focuses the page heading after create and redirect', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/new');
    await fillNew(user, '12,99');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    const heading = await screen.findByRole('heading', { level: 1, name: 'Edit book' });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it('names the Format select through its label, and marks it invalid with a message', async () => {
    patchResponse = () =>
      apiError(400, 'VALIDATION_FAILED', [{ path: 'mediaType', message: 'bad' }]);
    const user = userEvent.setup();
    renderAt('/catalog/b1/edit');
    await screen.findByDisplayValue('Draft Novel');
    const select = screen.getByLabelText('Format');
    expect(select).not.toHaveAttribute('aria-label');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(select).toHaveAttribute('aria-invalid', 'true'));
    expect(select).toHaveAccessibleDescription('Choose a format.');
  });
});
