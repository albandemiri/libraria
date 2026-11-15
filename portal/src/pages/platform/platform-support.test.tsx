import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import i18n from '../../i18n';
import { Sidebar } from '../../layout/Sidebar';
import PlatformBooksPage from './PlatformBooksPage';
import ReaderPage from './ReaderPage';
import ReadersPage from './ReadersPage';

expect.extend(axeMatchers);
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const scope = vi.hoisted(() => ({
  setPublisherId: vi.fn(),
  value: {
    publisherId: undefined as string | undefined,
    isAdmin: true,
    publishers: [] as Array<{ id: string; name: string }>,
  },
}));
vi.mock('../../layout/PublisherScope', () => ({
  usePublisherScope: () => ({ ...scope.value, setPublisherId: scope.setPublisherId }),
}));
vi.mock('../../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'a1', email: 'admin@libraria.example', role: 'admin' } }),
}));

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const B1 = 'b1111111-1111-4111-8111-111111111111';
const B2 = 'b2222222-2222-4222-8222-222222222222';
const R1 = 'a1111111-1111-4111-8111-111111111111';
const R2 = 'a2222222-2222-4222-8222-222222222222';

const publishers = [
  {
    id: P1,
    name: 'Botimet Drita',
    country: 'AL',
    contactEmail: 'info@drita.example',
    currentRateBps: 2000,
    bookCount: 2,
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: P2,
    name: 'Shtëpia Ura',
    country: 'XK',
    contactEmail: 'ura@ura.example',
    currentRateBps: null,
    bookCount: 1,
    createdAt: '2026-01-02T00:00:00Z',
  },
];

const book = (id: string, title: string, status: string, publisherId = P1) => ({
  id,
  publisherId,
  publisherName: publisherId === P1 ? 'Botimet Drita' : 'Shtëpia Ura',
  title,
  author: 'A. Autori',
  status,
  price: { amountCents: 999, currency: 'EUR' },
  coverImageUrl: null,
  coverThumbUrl: null,
  updatedAt: '2026-03-01T00:00:00Z',
  metrics: { salesCount: 4, totalRevenueCents: 3996, earningsCents: 2800 },
});
const books = [book(B1, 'Rrugë pa fund', 'published'), book(B2, 'Libri i hequr', 'withdrawn', P2)];

const reader = {
  id: R1,
  email: 'ana@reader.example',
  displayName: 'Ana',
  status: 'active',
  createdAt: '2026-02-01T00:00:00Z',
};
const device = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  platform: 'android',
  displayName: name,
  registeredAt: '2026-02-02T00:00:00Z',
  lastSeenAt: '2026-03-02T00:00:00Z',
  revokedAt: null,
  counted: true,
  ...over,
});
const detail = () => ({
  reader,
  booksOwned: 7,
  devices: [
    device('d1', 'Ana phone'),
    device('d2', 'Old tablet', { revokedAt: '2026-03-03T00:00:00Z', counted: false }),
  ],
  removalsThisYear: 2,
});

type Call = { method: string; path: string; search: URLSearchParams; body: unknown };
let calls: Call[];
let overrides: Record<string, () => Response>;
let booksResponse: () => unknown;
let readerDetail: () => unknown;

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const err = (status: number, code: string) =>
  json(status, { error: { code, message: 'English words', requestId: 'r' } });

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(String(input), 'http://x');
  const path = url.pathname.replace('/api/v1', '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, search: url.searchParams, body });
  const key = `${method} ${path}`;
  if (overrides[key]) return overrides[key]();

  if (key === 'GET /admin/publishers') return json(200, { publishers });
  if (key === 'GET /admin/books') return json(200, booksResponse());
  if (key === `POST /admin/books/${B1}/withdraw`) return json(200, { book: {} });
  if (key === `POST /admin/books/${B2}/reinstate`) return json(200, { book: {}, note: 'x' });
  if (key === 'GET /admin/readers') {
    return json(200, { readers: [reader, { ...reader, id: R2, email: 'ana2@reader.example' }] });
  }
  if (key === `GET /admin/readers/${R1}`) return json(200, readerDetail());
  if (key === `PATCH /admin/users/${R1}/status`) return json(200, { user: {} });
  if (key === 'DELETE /admin/devices/d1') return json(204, null);
  if (key === `POST /admin/users/${R1}/device-removals/reset`) return json(204, null);
  return err(404, 'NOT_FOUND');
});

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

let lastClient: QueryClient;
function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = client;
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Routes>
            <Route path="/platform/books" element={<PlatformBooksPage />} />
            <Route path="/platform/readers" element={<ReadersPage />} />
            <Route path="/platform/readers/:readerId" element={<ReaderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const sent = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);
const lastBooksCall = () => sent('GET', '/admin/books').at(-1) as Call;

beforeEach(async () => {
  calls = [];
  overrides = {};
  booksResponse = () => ({
    books,
    pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
  });
  readerDetail = detail;
  scope.setPublisherId.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});

describe('Platform navigation', () => {
  it('lists Books and Readers in the Platform group', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <Sidebar collapsed={false} onToggle={() => undefined} />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    expect(screen.getByRole('link', { name: 'All books' })).toHaveAttribute(
      'href',
      '/platform/books',
    );
    expect(screen.getByRole('link', { name: 'Readers' })).toHaveAttribute(
      'href',
      '/platform/readers',
    );
  });
});

describe('Platform books', () => {
  it('lists every publisher’s books with the publisher name and default query', async () => {
    renderAt('/platform/books');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: 'Rrugë pa fund' })).toHaveAttribute(
      'href',
      `/catalog/${B1}`,
    );
    expect(within(rows[0]).getByText('Botimet Drita')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Shtëpia Ura')).toBeInTheDocument();
    const q = lastBooksCall().search;
    expect(q.get('status')).toBe('all');
    expect(q.get('sort')).toBe('updated');
    expect(q.get('order')).toBe('desc');
    expect(q.get('page')).toBe('1');
    expect(q.has('q')).toBe(false);
    expect(q.has('publisherId')).toBe(false);
  });

  it('reads search, publisher, status, sort and page from the URL', async () => {
    renderAt(
      `/platform/books?q=rruge&publisherId=${P2}&status=published&sort=title&order=asc&page=2`,
    );
    await screen.findByRole('table');
    const q = lastBooksCall().search;
    expect(q.get('q')).toBe('rruge');
    expect(q.get('publisherId')).toBe(P2);
    expect(q.get('status')).toBe('published');
    expect(q.get('sort')).toBe('title');
    expect(q.get('order')).toBe('asc');
    expect(q.get('page')).toBe('2');
    expect(screen.getByRole('combobox', { name: 'Publisher' })).toHaveValue(P2);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('published');
    expect(screen.getByRole('searchbox', { name: 'Search books' })).toHaveValue('rruge');
  });

  it.each([
    ['?publisherId=zzz&status=bogus&sort=bogus&order=sideways&page=-3'],
    ['?publisherId=33333333-3333-4333-8333-333333333333&page=abc&status='],
    ['?page=1.5&order=ASC'],
  ])('falls back to the defaults for garbage in %s', async (qs) => {
    renderAt(`/platform/books${qs}`);
    await screen.findByRole('table');
    const q = lastBooksCall().search;
    expect(q.has('publisherId')).toBe(false);
    expect(q.get('status')).toBe('all');
    expect(q.get('sort')).toBe('updated');
    expect(q.get('order')).toBe('desc');
    expect(q.get('page')).toBe('1');
    expect(screen.getByRole('combobox', { name: 'Publisher' })).toHaveValue('');
  });

  it('writes the filters to the URL and resets the page', async () => {
    const user = userEvent.setup();
    renderAt('/platform/books?page=3');
    await screen.findByRole('table');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Publisher' }), P1);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(`publisherId=${P1}`));
    expect(screen.getByTestId('where')).not.toHaveTextContent('page=');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'draft');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('status=draft'));
    await user.type(screen.getByRole('searchbox', { name: 'Search books' }), 'fund');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('q=fund'));
    await waitFor(() => {
      const q = lastBooksCall().search;
      expect(q.get('q')).toBe('fund');
      expect(q.get('publisherId')).toBe(P1);
      expect(q.get('status')).toBe('draft');
    });
  });

  it('sorts from the column header and resets the page', async () => {
    const user = userEvent.setup();
    renderAt('/platform/books?page=2');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: /Price/ }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('sort=price'));
    expect(screen.getByTestId('where')).toHaveTextContent('order=asc');
    expect(screen.getByTestId('where')).not.toHaveTextContent('page=');
  });

  it('offers the last page when the page is past the end', async () => {
    const user = userEvent.setup();
    booksResponse = () => ({
      books: [],
      pagination: { page: 9, limit: 20, total: 45, totalPages: 3 },
    });
    renderAt('/platform/books?page=9');
    expect(await screen.findByText(/That page does not exist any more/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to the last page' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('page=3'));
  });

  it('shows pagination for several pages', async () => {
    booksResponse = () => ({
      books,
      pagination: { page: 1, limit: 20, total: 45, totalPages: 3 },
    });
    renderAt('/platform/books');
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: /Next/ })).toBeEnabled();
  });

  it('says so when no book matches the filters', async () => {
    booksResponse = () => ({
      books: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    renderAt('/platform/books?status=draft');
    expect(await screen.findByText('No books match these filters.')).toBeInTheDocument();
  });

  it('opening a book acts as its publisher', async () => {
    const user = userEvent.setup();
    renderAt('/platform/books');
    await user.click(await screen.findByRole('link', { name: 'Libri i hequr' }));
    expect(scope.setPublisherId).toHaveBeenCalledWith(P2);
  });

  describe('withdraw', () => {
    async function openWithdraw() {
      const user = userEvent.setup();
      renderAt('/platform/books');
      await user.click(await screen.findByRole('button', { name: 'Withdraw Rrugë pa fund' }));
      const dialog = await screen.findByRole('dialog', { name: 'Withdraw Rrugë pa fund?' });
      return { user, dialog };
    }

    it('warns that buyers lose access and needs a reason', async () => {
      const { user, dialog } = await openWithdraw();
      expect(
        within(dialog).getByText(/People who already bought it lose access/),
      ).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Withdraw book' }));
      expect(within(dialog).getByText('Enter a reason for the withdrawal')).toBeInTheDocument();
      await waitFor(() =>
        expect(within(dialog).getByRole('textbox', { name: /Reason/ })).toHaveFocus(),
      );
      await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), '   ');
      await user.click(within(dialog).getByRole('button', { name: 'Withdraw book' }));
      expect(sent('POST', `/admin/books/${B1}/withdraw`)).toHaveLength(0);
    });

    it('sends the trimmed reason, closes and says it is done', async () => {
      const { user, dialog } = await openWithdraw();
      await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), '  Court order 12 ');
      await user.click(within(dialog).getByRole('button', { name: 'Withdraw book' }));
      await waitFor(() => expect(sent('POST', `/admin/books/${B1}/withdraw`)).toHaveLength(1));
      expect(sent('POST', `/admin/books/${B1}/withdraw`)[0].body).toEqual({
        reason: 'Court order 12',
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText('Rrugë pa fund was withdrawn.')).toBeInTheDocument();
    });

    it('refreshes the publisher catalog too, not only the admin lists', async () => {
      const { user, dialog } = await openWithdraw();
      const spy = vi.spyOn(lastClient, 'invalidateQueries');
      await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Because');
      await user.click(within(dialog).getByRole('button', { name: 'Withdraw book' }));
      await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['books'] }));
      expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'books'] });
    });

    it('cancel sends nothing', async () => {
      const { user, dialog } = await openWithdraw();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(sent('POST', `/admin/books/${B1}/withdraw`)).toHaveLength(0);
    });

    it('shows a translated error in the dialog and moves focus to it', async () => {
      overrides[`POST /admin/books/${B1}/withdraw`] = () => err(404, 'NOT_FOUND');
      const { user, dialog } = await openWithdraw();
      await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Because');
      await user.click(within(dialog).getByRole('button', { name: 'Withdraw book' }));
      const alert = await within(dialog).findByRole('alert');
      expect(alert).toHaveTextContent('That item no longer exists. Refresh the page.');
      expect(alert).not.toHaveTextContent('English words');
      await waitFor(() => expect(alert.parentElement).toHaveFocus());
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has no accessibility violations (page and dialog)', async () => {
      const { container } = renderAt('/platform/books');
      await screen.findByRole('table');
      expect(await axe(container)).toHaveNoViolations();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Withdraw Rrugë pa fund' }));
      const dialog = await screen.findByRole('dialog');
      expect(await axe(dialog)).toHaveNoViolations();
    });
  });

  describe('reinstate', () => {
    it('reinstates a withdrawn book and says it must be republished', async () => {
      const user = userEvent.setup();
      renderAt('/platform/books');
      await user.click(await screen.findByRole('button', { name: 'Reinstate Libri i hequr' }));
      await waitFor(() => expect(sent('POST', `/admin/books/${B2}/reinstate`)).toHaveLength(1));
      expect(await screen.findByText(/Libri i hequr was reinstated/)).toHaveTextContent(
        'publishes it again',
      );
      // A published book is not offered a reinstate, and a withdrawn one no withdraw.
      expect(screen.queryByRole('button', { name: 'Reinstate Rrugë pa fund' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Withdraw Libri i hequr' })).toBeNull();
    });

    it('shows a translated error and focuses it', async () => {
      overrides[`POST /admin/books/${B2}/reinstate`] = () => err(500, 'INTERNAL');
      const user = userEvent.setup();
      renderAt('/platform/books');
      await user.click(await screen.findByRole('button', { name: 'Reinstate Libri i hequr' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('Something went wrong. Please try again.');
      await waitFor(() => expect(alert.parentElement).toHaveFocus());
    });
  });
});

describe('Readers search', () => {
  it('sends nothing for a query under 3 characters and shows a hint', async () => {
    const user = userEvent.setup();
    renderAt('/platform/readers');
    expect(screen.getByText(/Type at least 3 characters/)).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search readers by email' }), 'an');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('q=an'));
    expect(sent('GET', '/admin/readers')).toHaveLength(0);
    expect(screen.getByText(/Type at least 3 characters/)).toBeInTheDocument();
  });

  it('sends nothing for a query of spaces', async () => {
    renderAt('/platform/readers?q=%20%20%20%20');
    expect(screen.getByText(/Type at least 3 characters/)).toBeInTheDocument();
    expect(sent('GET', '/admin/readers')).toHaveLength(0);
  });

  it('searches from 3 characters and links each result to the reader page', async () => {
    const user = userEvent.setup();
    renderAt('/platform/readers');
    await user.type(screen.getByRole('searchbox', { name: 'Search readers by email' }), 'ana');
    // The search box waits out its debounce before it reaches the URL and the server.
    const table = await screen.findByRole('table', {}, { timeout: 3000 });
    expect(sent('GET', '/admin/readers').at(-1)?.search.get('q')).toBe('ana');
    expect(within(table).getByRole('link', { name: 'ana@reader.example' })).toHaveAttribute(
      'href',
      `/platform/readers/${R1}`,
    );
    expect(within(table).getByRole('link', { name: 'ana2@reader.example' })).toHaveAttribute(
      'href',
      `/platform/readers/${R2}`,
    );
  });

  it('searches an exact email straight from the URL', async () => {
    renderAt('/platform/readers?q=ana%40reader.example');
    await screen.findByRole('table');
    expect(sent('GET', '/admin/readers')[0].search.get('q')).toBe('ana@reader.example');
  });

  it('says so when nobody matches', async () => {
    overrides['GET /admin/readers'] = () => json(200, { readers: [] });
    renderAt('/platform/readers?q=zzz');
    expect(await screen.findByText('No reader matches that email.')).toBeInTheDocument();
  });

  it('maps a server refusal to translated text and focuses it', async () => {
    overrides['GET /admin/readers'] = () => err(400, 'VALIDATION_FAILED');
    renderAt('/platform/readers?q=abc');
    const alert = await screen.findByRole('alert');
    // One alert, not an alert inside a second live region.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(alert.closest('[aria-live]')).toBeNull();
    expect(alert).toHaveTextContent('Check the details and try again.');
    expect(alert).not.toHaveTextContent('English words');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAt('/platform/readers?q=ana');
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no accessibility violations on the hint', async () => {
    const { container } = renderAt('/platform/readers');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Reader page', () => {
  it('shows the reader, the counts and the devices', async () => {
    renderAt(`/platform/readers/${R1}`);
    expect(await screen.findByRole('heading', { name: 'ana@reader.example' })).toBeInTheDocument();
    expect(screen.getByText('Books owned').nextSibling).toHaveTextContent('7');
    // The count is a rolling 12 months, and the label says so.
    expect(screen.getByText('Device removals in the last 12 months').nextSibling).toHaveTextContent(
      '2',
    );
    const table = screen.getByRole('region', { name: 'Reader devices' });
    expect(within(table).getByText('Ana phone')).toBeInTheDocument();
    expect(within(table).getByText('In use')).toBeInTheDocument();
    expect(within(table).getByText('Removed')).toBeInTheDocument();
    // A removed device cannot be removed again.
    expect(screen.queryByRole('button', { name: 'Remove Old tablet' })).toBeNull();
  });

  it.each([
    [`/platform/readers/${R2}`, 404],
    ['/platform/readers/not-a-uuid', 400],
  ])('shows "not found" for %s', async (path, status) => {
    overrides[`GET ${path.replace('/platform', '/admin')}`] = () =>
      err(status, status === 404 ? 'NOT_FOUND' : 'VALIDATION_FAILED');
    renderAt(path);
    expect(await screen.findByText('Reader not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All readers' })).toHaveAttribute(
      'href',
      '/platform/readers',
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('suspends after a confirmation', async () => {
    const user = userEvent.setup();
    renderAt(`/platform/readers/${R1}`);
    await user.click(await screen.findByRole('button', { name: 'Suspend' }));
    expect(sent('PATCH', `/admin/users/${R1}/status`)).toHaveLength(0);
    const dialog = await screen.findByRole('dialog', { name: 'Suspend ana@reader.example?' });
    await user.click(within(dialog).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(sent('PATCH', `/admin/users/${R1}/status`)).toHaveLength(1));
    expect(sent('PATCH', `/admin/users/${R1}/status`)[0].body).toEqual({ status: 'suspended' });
    expect(await screen.findByText('The reader was suspended.')).toBeInTheDocument();
  });

  it('reactivates at once', async () => {
    readerDetail = () => ({ ...detail(), reader: { ...reader, status: 'suspended' } });
    const user = userEvent.setup();
    renderAt(`/platform/readers/${R1}`);
    await user.click(await screen.findByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(sent('PATCH', `/admin/users/${R1}/status`)).toHaveLength(1));
    expect(sent('PATCH', `/admin/users/${R1}/status`)[0].body).toEqual({ status: 'active' });
    expect(await screen.findByText('The reader was reactivated.')).toBeInTheDocument();
  });

  it('removes a device only after a confirmation', async () => {
    const user = userEvent.setup();
    renderAt(`/platform/readers/${R1}`);
    await user.click(await screen.findByRole('button', { name: 'Remove Ana phone' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Ana phone?' });
    expect(sent('DELETE', '/admin/devices/d1')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(sent('DELETE', '/admin/devices/d1')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Remove Ana phone' }));
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'Remove device' }));
    await waitFor(() => expect(sent('DELETE', '/admin/devices/d1')).toHaveLength(1));
    expect(await screen.findByText('Ana phone was removed.')).toBeInTheDocument();
    // The Remove button is gone for a removed device, so focus lands on the heading.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'ana@reader.example' })).toHaveFocus(),
    );
  });

  it('resets the removal count only after a confirmation', async () => {
    const user = userEvent.setup();
    renderAt(`/platform/readers/${R1}`);
    await user.click(await screen.findByRole('button', { name: 'Reset removals' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset the removal count?' });
    expect(sent('POST', `/admin/users/${R1}/device-removals/reset`)).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Reset count' }));
    await waitFor(() =>
      expect(sent('POST', `/admin/users/${R1}/device-removals/reset`)).toHaveLength(1),
    );
    expect(await screen.findByText('The removal count was reset.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'ana@reader.example' })).toHaveFocus(),
    );
  });

  it('keeps the page and shows a notice when a refresh fails', async () => {
    const user = userEvent.setup();
    renderAt(`/platform/readers/${R1}`);
    await screen.findByRole('heading', { name: 'ana@reader.example' });
    overrides[`GET /admin/readers/${R1}`] = () => err(500, 'INTERNAL');
    await user.click(screen.getByRole('button', { name: 'Reset removals' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset count' }),
    );
    expect(await screen.findByText(/Could not refresh this reader/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ana@reader.example' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('maps a failure to translated text and focuses it', async () => {
    overrides['DELETE /admin/devices/d1'] = () => err(404, 'NOT_FOUND');
    const user = userEvent.setup();
    renderAt(`/platform/readers/${R1}`);
    await user.click(await screen.findByRole('button', { name: 'Remove Ana phone' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove device' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That item no longer exists. Refresh the page.');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
  });

  it('does not re-read (and so re-audit) the reader on window focus', async () => {
    renderAt(`/platform/readers/${R1}`);
    await screen.findByRole('heading', { name: 'ana@reader.example' });
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(sent('GET', `/admin/readers/${R1}`)).toHaveLength(1);
  });

  it('has no accessibility violations (page and every dialog)', async () => {
    const user = userEvent.setup();
    const { container } = renderAt(`/platform/readers/${R1}`);
    await screen.findByRole('region', { name: 'Reader devices' });
    expect(await axe(container)).toHaveNoViolations();
    for (const name of ['Suspend', 'Reset removals', 'Remove Ana phone']) {
      await user.click(screen.getByRole('button', { name }));
      const dialog = await screen.findByRole('dialog');
      expect(await axe(dialog)).toHaveNoViolations();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
  });
});
