import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import i18n from '../../i18n';
import { formatMoney } from '../../lib/format';
import { Sidebar } from '../../layout/Sidebar';
import PlatformOverviewPage from './PlatformOverviewPage';
import PublisherPage from './PublisherPage';
import PublishersPage from './PublishersPage';

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

const auth = vi.hoisted(() => ({
  user: { id: 'a1', email: 'admin@libraria.example', role: 'admin' } as {
    id: string;
    email: string;
    role: string;
  },
}));
vi.mock('../../auth/AuthProvider', () => ({ useAuth: () => ({ user: auth.user }) }));

const drita = {
  id: 'p1',
  name: 'Botimet Drita',
  country: 'AL',
  contactEmail: 'info@drita.example',
  currentRateBps: 2000,
  bookCount: 12,
  createdAt: '2026-01-01T00:00:00Z',
};
const ura = {
  id: 'p2',
  name: 'Shtëpia Ura',
  country: 'XK',
  contactEmail: 'ura@ura.example',
  currentRateBps: null,
  bookCount: 5,
  createdAt: '2026-01-02T00:00:00Z',
};

const ZERO = {
  grossCents: 0,
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
  earningsCents: 0,
  copies: 0,
  refundedCopies: 0,
};
const metrics = (over: Partial<typeof ZERO>) => ({ ...ZERO, ...over });

const summary = {
  totals: metrics({
    grossCents: 150000,
    copies: 30,
    refundsCents: 2000,
    commissionCents: 28000,
    earningsCents: 100000,
  }),
  series: [
    { periodStart: '2026-03-01', ...metrics({ grossCents: 90000, copies: 18 }) },
    { periodStart: '2026-03-02', ...metrics({ grossCents: 60000, copies: 12 }) },
  ],
};
const byPublisher = {
  rows: [
    {
      publisherId: 'p1',
      publisherName: 'Botimet Drita',
      currentRateBps: 2000,
      ...metrics({
        grossCents: 100000,
        copies: 20,
        refundsCents: 1500,
        commissionCents: 20000,
        earningsCents: 70000,
      }),
    },
    {
      publisherId: 'p2',
      publisherName: 'Shtëpia Ura',
      currentRateBps: null,
      ...metrics({
        grossCents: 50000,
        copies: 10,
        refundsCents: 500,
        commissionCents: 8000,
        earningsCents: 30000,
      }),
    },
  ],
};

const LINK = 'http://localhost:5173/invite#token=SECRETTOKEN123';

const team = {
  id: 'u1',
  email: 'ana@drita.example',
  displayName: 'Ana',
  status: 'active',
  createdAt: '2026-02-01T00:00:00Z',
};
const pending = {
  id: 'i1',
  email: 'beni@drita.example',
  displayName: 'Beni',
  createdAt: '2026-03-01T00:00:00Z',
  expiresAt: '2099-03-08T00:00:00Z',
};

const book = {
  id: 'b1',
  publisherId: 'p1',
  publisherName: 'Botimet Drita',
  title: 'Rrugë pa fund',
  author: 'A. Autori',
  status: 'published',
  price: { amountCents: 999, currency: 'EUR' },
  coverImageUrl: null,
  coverThumbUrl: null,
  metrics: { salesCount: 4, totalRevenueCents: 3996, earningsCents: 2800 },
};

const rate = (id: string, rateBps: number, status: string, ref: string | null) => ({
  id,
  rateBps,
  effectiveFrom: '2026-01-01T00:00:00Z',
  contractReference: ref,
  inForce: status === 'active',
  status,
});

type Call = { method: string; path: string; search: URLSearchParams; body: unknown };
let calls: Call[];
let client: QueryClient;
let detail: { publisher: typeof drita; team: unknown[]; invites: unknown[] };
let overrides: Record<string, () => Response>;

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const err = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: 'x', requestId: 'r', details } });

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(String(input), 'http://x');
  const path = url.pathname.replace('/api/v1', '');
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method, path, search: url.searchParams, body });
  const key = `${method} ${path}`;
  if (overrides[key]) return overrides[key]();

  if (key === 'GET /admin/publishers') return json(200, { publishers: [drita, ura] });
  if (key === 'POST /admin/publishers') return json(201, { publisher: { ...drita, id: 'p9' } });
  if (key === 'GET /admin/publishers/p1') return json(200, detail);
  if (key === 'GET /admin/publishers/nope') return err(404, 'NOT_FOUND');
  if (key === 'PATCH /admin/publishers/p1') return json(200, { publisher: drita });
  if (key === 'POST /admin/publishers/p1/invites') {
    return json(201, { invite: pending, link: LINK });
  }
  if (key === 'DELETE /admin/invites/i1') return json(204, null);
  if (key === 'PATCH /admin/users/u1/status') {
    return json(200, { user: { id: 'u1', status: (body as { status: string }).status } });
  }
  if (key === 'GET /admin/publishers/p1/commission-rates') {
    return json(200, {
      publisherId: 'p1',
      rates: [rate('r2', 2000, 'active', 'REF-42'), rate('r1', 2500, 'superseded', null)],
    });
  }
  if (key === 'POST /admin/publishers/p1/commission-rates') {
    return json(201, { rate: rate('r3', 1750, 'scheduled', 'NEW') });
  }
  if (key === 'GET /admin/books') {
    return json(200, {
      books: [book],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });
  }
  if (key === 'GET /admin/reports/summary') return json(200, summary);
  if (key === 'GET /admin/reports/by-publisher') return json(200, byPublisher);
  return err(404, 'NOT_FOUND');
});

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{`${pathname}${search}`}</p>;
}

function renderAt(path: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Routes>
            <Route path="/platform" element={<PlatformOverviewPage />} />
            <Route path="/platform/publishers" element={<PublishersPage />} />
            <Route path="/platform/publishers/:publisherId" element={<PublisherPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const sent = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.path === path);

/** A date input takes its value in one go; typing character by character fights the mask. */
function setDate(input: HTMLElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

beforeEach(async () => {
  calls = [];
  overrides = {};
  detail = { publisher: drita, team: [team], invites: [pending] };
  scope.setPublisherId.mockReset();
  auth.user = { id: 'a1', email: 'admin@libraria.example', role: 'admin' };
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('Platform navigation', () => {
  function renderSidebar() {
    return render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <Sidebar collapsed={false} onToggle={() => undefined} />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    );
  }

  it('shows the Platform group to an admin', () => {
    renderSidebar();
    expect(screen.getByRole('heading', { name: 'Platform' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Platform overview' })).toHaveAttribute(
      'href',
      '/platform',
    );
    expect(screen.getByRole('link', { name: 'Publishers' })).toHaveAttribute(
      'href',
      '/platform/publishers',
    );
  });

  it('hides the Platform group from a publisher', () => {
    auth.user = { id: 'u9', email: 'p@example.com', role: 'publisher' };
    renderSidebar();
    expect(screen.queryByRole('heading', { name: 'Platform' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Publishers' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Catalog' })).toBeInTheDocument();
  });
});

describe('Platform overview', () => {
  it('shows the fixture figures and sends the shared date range', async () => {
    renderAt('/platform?from=2026-03-01&to=2026-04-01');
    const figures = await screen.findByRole('group', { name: 'Platform figures' });
    expect(within(figures).getByText('€1,500.00')).toBeInTheDocument();
    expect(within(figures).getByText('30')).toBeInTheDocument();
    expect(within(figures).getByText('€20.00')).toBeInTheDocument();
    expect(within(figures).getByText('€280.00')).toBeInTheDocument();
    expect(within(figures).getByText('€1,000.00')).toBeInTheDocument();

    const summaryCall = sent('GET', '/admin/reports/summary')[0];
    expect(summaryCall.search.get('from')).toBe('2026-03-01');
    expect(summaryCall.search.get('to')).toBe('2026-04-01');
    const rowsCall = sent('GET', '/admin/reports/by-publisher')[0];
    expect(rowsCall.search.get('from')).toBe('2026-03-01');
    expect(rowsCall.search.get('to')).toBe('2026-04-01');
  });

  it('shows figures equal to the sum of the by-publisher rows', async () => {
    renderAt('/platform?from=2026-03-01&to=2026-04-01');
    const figures = await screen.findByRole('group', { name: 'Platform figures' });
    const keys = ['grossCents', 'refundsCents', 'commissionCents', 'earningsCents'] as const;
    for (const key of keys) {
      const sum = byPublisher.rows.reduce((total, row) => total + row[key], 0);
      expect(summary.totals[key]).toBe(sum);
      expect(within(figures).getByText(formatMoney(sum, 'en'))).toBeInTheDocument();
    }
    const copies = byPublisher.rows.reduce((total, row) => total + row.copies, 0);
    expect(within(figures).getByText(String(copies))).toBeInTheDocument();
  });

  it('lists each publisher with a link, and flags one with no contract', async () => {
    renderAt('/platform?from=2026-03-01&to=2026-04-01');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: 'Botimet Drita' })).toHaveAttribute(
      'href',
      '/platform/publishers/p1',
    );
    expect(within(rows[0]).getByText('€1,000.00')).toBeInTheDocument();
    expect(within(rows[0]).getByText('20%')).toBeInTheDocument();
    expect(within(rows[1]).getByRole('link', { name: 'Shtëpia Ura' })).toHaveAttribute(
      'href',
      '/platform/publishers/p2',
    );
    expect(within(rows[1]).getByText('No contract yet')).toBeInTheDocument();
    expect(screen.getByText(/1 publisher has no contract rate yet/)).toBeInTheDocument();
  });

  it('offers a retry when the figures cannot load', async () => {
    overrides['GET /admin/reports/summary'] = () => err(500, 'INTERNAL');
    renderAt('/platform?from=2026-03-01&to=2026-04-01');
    expect((await screen.findAllByRole('button', { name: 'Retry' })).length).toBeGreaterThan(0);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAt('/platform?from=2026-03-01&to=2026-04-01');
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Publishers list', () => {
  it('shows name, country, email, rate and books', async () => {
    renderAt('/platform/publishers');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1) as HTMLElement[];
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole('link', { name: 'Botimet Drita' })).toHaveAttribute(
      'href',
      '/platform/publishers/p1',
    );
    expect(within(rows[0]).getByText('Albania')).toBeInTheDocument();
    expect(within(rows[0]).getByText('info@drita.example')).toBeInTheDocument();
    expect(within(rows[0]).getByText('20%')).toBeInTheDocument();
    expect(within(rows[0]).getByText('12')).toBeInTheDocument();
    expect(within(rows[1]).getByText('No contract yet')).toBeInTheDocument();
  });

  it('searches by name through the URL and sends no empty q', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers');
    await screen.findByRole('table');
    expect(sent('GET', '/admin/publishers')[0].search.has('q')).toBe(false);
    await user.type(screen.getByRole('searchbox', { name: 'Search publishers by name' }), 'dri');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('?q=dri'));
    await waitFor(() =>
      expect(sent('GET', '/admin/publishers').some((c) => c.search.get('q') === 'dri')).toBe(true),
    );
  });

  it('validates the new-publisher form and sends nothing while it is invalid', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New publisher' }));
    const dialog = await screen.findByRole('dialog', { name: 'New publisher' });
    await user.click(within(dialog).getByRole('button', { name: 'Create publisher' }));
    expect(within(dialog).getByText("Enter the publisher's name")).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid email address')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Name/), 'Ura Press');
    await user.type(within(dialog).getByLabelText(/Contact email/), 'not-an-email');
    await user.click(within(dialog).getByRole('button', { name: 'Create publisher' }));
    expect(within(dialog).getByText('Enter a valid email address')).toBeInTheDocument();
    expect(sent('POST', '/admin/publishers')).toHaveLength(0);
  });

  it('creates a publisher with Albania as the default country, then opens it', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New publisher' }));
    const dialog = await screen.findByRole('dialog', { name: 'New publisher' });
    await user.type(within(dialog).getByLabelText(/Name/), '  Ura Press ');
    await user.type(within(dialog).getByLabelText(/Contact email/), 'hello@ura.example');
    await user.click(within(dialog).getByRole('button', { name: 'Create publisher' }));
    await waitFor(() => expect(sent('POST', '/admin/publishers')).toHaveLength(1));
    expect(sent('POST', '/admin/publishers')[0].body).toEqual({
      name: 'Ura Press',
      contactEmail: 'hello@ura.example',
      country: 'AL',
    });
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/platform/publishers/p9'),
    );
  });

  it('sends ZZ for the "Other" country', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New publisher' }));
    const dialog = await screen.findByRole('dialog', { name: 'New publisher' });
    await user.type(within(dialog).getByLabelText(/Name/), 'Far Away');
    await user.type(within(dialog).getByLabelText(/Contact email/), 'a@far.example');
    await user.selectOptions(within(dialog).getByLabelText(/Country/), 'Other');
    await user.click(within(dialog).getByRole('button', { name: 'Create publisher' }));
    await waitFor(() => expect(sent('POST', '/admin/publishers')).toHaveLength(1));
    expect(sent('POST', '/admin/publishers')[0].body).toMatchObject({ country: 'ZZ' });
  });

  it('shows a server refusal in the dialog', async () => {
    overrides['POST /admin/publishers'] = () => err(500, 'INTERNAL');
    const user = userEvent.setup();
    renderAt('/platform/publishers');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New publisher' }));
    const dialog = await screen.findByRole('dialog', { name: 'New publisher' });
    await user.type(within(dialog).getByLabelText(/Name/), 'Ura Press');
    await user.type(within(dialog).getByLabelText(/Contact email/), 'hello@ura.example');
    await user.click(within(dialog).getByRole('button', { name: 'Create publisher' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Something went wrong/);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAt('/platform/publishers');
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Publisher page', () => {
  it('opens on Details, and a hand-edited tab falls back to Details', async () => {
    renderAt('/platform/publishers/p1?tab=garbage');
    expect(await screen.findByRole('heading', { name: 'Botimet Drita' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Details', selected: true })).toBeInTheDocument();
    expect(screen.getByLabelText(/Contact email/)).toHaveValue('info@drita.example');
  });

  it('says so when the publisher does not exist', async () => {
    renderAt('/platform/publishers/nope');
    expect(await screen.findByText('Publisher not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All publishers' })).toHaveAttribute(
      'href',
      '/platform/publishers',
    );
  });

  it('edits the details and sends only what changed', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers/p1');
    const name = await screen.findByLabelText(/Name/);
    await user.clear(name);
    await user.type(name, 'Drita Libri');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(sent('PATCH', '/admin/publishers/p1')).toHaveLength(1));
    expect(sent('PATCH', '/admin/publishers/p1')[0].body).toEqual({ name: 'Drita Libri' });
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
  });

  describe('Team', () => {
    it('lists the logins and the pending invites', async () => {
      renderAt('/platform/publishers/p1?tab=team');
      const logins = await screen.findByRole('region', { name: 'Logins' });
      expect(within(logins).getByText('ana@drita.example')).toBeInTheDocument();
      expect(within(logins).getByText('Active')).toBeInTheDocument();
      const invites = screen.getByRole('region', { name: 'Pending invites' });
      expect(within(invites).getByText('beni@drita.example')).toBeInTheDocument();
    });

    it('creates an invite, shows the link once and copies it to the clipboard', async () => {
      const user = userEvent.setup();
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });

      await user.click(screen.getByRole('button', { name: 'Invite a person' }));
      const form = await screen.findByRole('dialog', { name: 'Invite a person' });
      await user.type(within(form).getByLabelText(/Email/), 'new@drita.example');
      await user.click(within(form).getByRole('button', { name: 'Create invite link' }));

      await waitFor(() => expect(sent('POST', '/admin/publishers/p1/invites')).toHaveLength(1));
      expect(sent('POST', '/admin/publishers/p1/invites')[0].body).toEqual({
        email: 'new@drita.example',
      });
      const linkDialog = await screen.findByRole('dialog', { name: /Invite link/ });
      expect(within(linkDialog).getByLabelText('Invite link')).toHaveValue(LINK);

      await user.click(within(linkDialog).getByRole('button', { name: 'Copy link' }));
      expect(writeText).toHaveBeenCalledWith(LINK);
      expect(await within(linkDialog).findByText('Link copied')).toBeInTheDocument();

      await user.click(within(linkDialog).getByRole('button', { name: 'Done' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // Gone for good: not in the page, not in the list.
      expect(document.body.innerHTML).not.toContain('SECRETTOKEN123');
      expect(screen.queryByDisplayValue(LINK)).not.toBeInTheDocument();
    });

    it('falls back to selecting the text when the clipboard API is missing', async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      const exec = vi.fn(() => true);
      Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
      renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      await user.click(screen.getByRole('button', { name: /Re-issue link.*beni@drita.example/ }));
      const linkDialog = await screen.findByRole('dialog', { name: /Invite link/ });
      await user.click(within(linkDialog).getByRole('button', { name: 'Copy link' }));
      expect(exec).toHaveBeenCalledWith('copy');
      expect(await within(linkDialog).findByText('Link copied')).toBeInTheDocument();
    });

    it('asks to copy by hand when nothing can copy', async () => {
      const user = userEvent.setup();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
        configurable: true,
      });
      Object.defineProperty(document, 'execCommand', {
        value: vi.fn(() => false),
        configurable: true,
      });
      renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      await user.click(screen.getByRole('button', { name: /Re-issue link.*beni@drita.example/ }));
      const linkDialog = await screen.findByRole('dialog', { name: /Invite link/ });
      await user.click(within(linkDialog).getByRole('button', { name: 'Copy link' }));
      expect(
        await within(linkDialog).findByText(/Select the link and copy it yourself/),
      ).toBeInTheDocument();
    });

    it('re-issues a pending invite for the same email and name', async () => {
      const user = userEvent.setup();
      renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      await user.click(screen.getByRole('button', { name: /Re-issue link.*beni@drita.example/ }));
      await waitFor(() => expect(sent('POST', '/admin/publishers/p1/invites')).toHaveLength(1));
      expect(sent('POST', '/admin/publishers/p1/invites')[0].body).toEqual({
        email: 'beni@drita.example',
        displayName: 'Beni',
      });
      const linkDialog = await screen.findByRole('dialog', { name: /Invite link/ });
      expect(within(linkDialog).getByLabelText('Invite link')).toHaveValue(LINK);
    });

    it('cancels a pending invite', async () => {
      const user = userEvent.setup();
      renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      await user.click(screen.getByRole('button', { name: /Cancel invite.*beni@drita.example/ }));
      await waitFor(() => expect(sent('DELETE', '/admin/invites/i1')).toHaveLength(1));
    });

    it('explains EMAIL_TAKEN when creating an invite', async () => {
      overrides['POST /admin/publishers/p1/invites'] = () => err(409, 'EMAIL_TAKEN');
      const user = userEvent.setup();
      renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      await user.click(screen.getByRole('button', { name: 'Invite a person' }));
      const form = await screen.findByRole('dialog', { name: 'Invite a person' });
      await user.type(within(form).getByLabelText(/Email/), 'reader@example.com');
      await user.click(within(form).getByRole('button', { name: 'Create invite link' }));
      expect(await within(form).findByRole('alert')).toHaveTextContent(
        /already has an account.*another email/i,
      );
    });

    it('suspends a login after confirmation, and reactivates one', async () => {
      const user = userEvent.setup();
      const { unmount } = renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      await user.click(screen.getByRole('button', { name: /Suspend.*ana@drita.example/ }));
      const confirm = await screen.findByRole('dialog', { name: /Suspend ana@drita.example/ });
      expect(sent('PATCH', '/admin/users/u1/status')).toHaveLength(0);
      await user.click(within(confirm).getByRole('button', { name: 'Suspend' }));
      await waitFor(() => expect(sent('PATCH', '/admin/users/u1/status')).toHaveLength(1));
      expect(sent('PATCH', '/admin/users/u1/status')[0].body).toEqual({ status: 'suspended' });
      unmount();

      calls = [];
      detail.team = [{ ...team, status: 'suspended' }];
      renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      expect(screen.getByText('Suspended')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Reactivate.*ana@drita.example/ }));
      await waitFor(() => expect(sent('PATCH', '/admin/users/u1/status')).toHaveLength(1));
      expect(sent('PATCH', '/admin/users/u1/status')[0].body).toEqual({ status: 'active' });
    });

    it('has no accessibility violations', async () => {
      const { container } = renderAt('/platform/publishers/p1?tab=team');
      await screen.findByRole('region', { name: 'Logins' });
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe('Contract', () => {
    it('shows the rate history', async () => {
      renderAt('/platform/publishers/p1?tab=contract');
      const table = await screen.findByRole('table');
      expect(within(table).getByText('REF-42')).toBeInTheDocument();
      expect(within(table).getByText('Active')).toBeInTheDocument();
      expect(within(table).getByText('Superseded')).toBeInTheDocument();
    });

    it('adds a rate in percent as basis points', async () => {
      const user = userEvent.setup();
      renderAt('/platform/publishers/p1?tab=contract');
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Add rate' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add a commission rate' });
      await user.type(within(dialog).getByLabelText(/Rate/), '17,5');
      setDate(within(dialog).getByLabelText(/Effective from/), '2099-01-01');
      await user.type(within(dialog).getByLabelText(/Contract reference/), 'NEW');
      await user.click(within(dialog).getByRole('button', { name: 'Add rate' }));
      await waitFor(() =>
        expect(sent('POST', '/admin/publishers/p1/commission-rates')).toHaveLength(1),
      );
      expect(sent('POST', '/admin/publishers/p1/commission-rates')[0].body).toEqual({
        rateBps: 1750,
        effectiveFrom: '2099-01-01T00:00:00.000Z',
        contractReference: 'NEW',
      });
    });

    it('refuses a rate that is not between 0 and 100', async () => {
      const user = userEvent.setup();
      renderAt('/platform/publishers/p1?tab=contract');
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Add rate' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add a commission rate' });
      await user.type(within(dialog).getByLabelText(/Rate/), '120');
      await user.click(within(dialog).getByRole('button', { name: 'Add rate' }));
      expect(within(dialog).getByText('Enter a rate between 0 and 100')).toBeInTheDocument();
      expect(sent('POST', '/admin/publishers/p1/commission-rates')).toHaveLength(0);
    });

    it('explains a duplicate start time', async () => {
      overrides['POST /admin/publishers/p1/commission-rates'] = () =>
        err(409, 'COMMISSION_RATE_EXISTS');
      const user = userEvent.setup();
      renderAt('/platform/publishers/p1?tab=contract');
      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Add rate' }));
      const dialog = await screen.findByRole('dialog', { name: 'Add a commission rate' });
      await user.type(within(dialog).getByLabelText(/Rate/), '20');
      await user.click(within(dialog).getByRole('button', { name: 'Add rate' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already has a rate/);
    });
  });

  describe('Books', () => {
    it('lists the publisher books and opens one acting as that publisher', async () => {
      const user = userEvent.setup();
      renderAt('/platform/publishers/p1?tab=books');
      const link = await screen.findByRole('link', { name: 'Rrugë pa fund' });
      expect(link).toHaveAttribute('href', '/catalog/b1');
      expect(sent('GET', '/admin/books')[0].search.get('publisherId')).toBe('p1');
      await user.click(link);
      expect(scope.setPublisherId).toHaveBeenCalledWith('p1');
    });
  });

  it('has no accessibility violations on Details and Books', async () => {
    const { container, unmount } = renderAt('/platform/publishers/p1');
    await screen.findByLabelText(/Contact email/);
    expect(await axe(container)).toHaveNoViolations();
    unmount();
    const second = renderAt('/platform/publishers/p1?tab=books');
    await screen.findByRole('link', { name: 'Rrugë pa fund' });
    expect(await axe(second.container)).toHaveNoViolations();
  });
});

describe('dialogs and focus', () => {
  async function openLinkDialog(user: ReturnType<typeof userEvent.setup>) {
    renderAt('/platform/publishers/p1?tab=team');
    await screen.findByRole('region', { name: 'Logins' });
    await user.click(screen.getByRole('button', { name: /Re-issue link.*beni@drita.example/ }));
    return screen.findByRole('dialog', { name: /Invite link/ });
  }

  it('does not keep a re-issued link in the mutation state', async () => {
    const user = userEvent.setup();
    const dialog = await openLinkDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const kept = JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data),
    );
    expect(kept).not.toContain('SECRETTOKEN123');
  });

  it('closes the link dialog only through Done, not Escape or an outside click', async () => {
    const user = userEvent.setup();
    const dialog = await openLinkDialog(user);
    expect(within(dialog).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole('dialog', { name: /Invite link/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clears the copy message on each click so every copy is announced', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise(() => undefined));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const dialog = await openLinkDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await within(dialog).findByText('Link copied')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(within(dialog).queryByText('Link copied')).not.toBeInTheDocument();
  });

  it('has no accessibility violations in the link, add-rate and new-publisher dialogs', async () => {
    const user = userEvent.setup();
    const link = await openLinkDialog(user);
    expect(await axe(link)).toHaveNoViolations();
    cleanup();

    renderAt('/platform/publishers/p1?tab=contract');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add rate' }));
    expect(await axe(await screen.findByRole('dialog'))).toHaveNoViolations();
    cleanup();

    renderAt('/platform/publishers');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New publisher' }));
    expect(await axe(await screen.findByRole('dialog'))).toHaveNoViolations();
  });

  it('moves focus to the first invalid field (new publisher, invite, add rate)', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'New publisher' }));
    let dialog = await screen.findByRole('dialog', { name: 'New publisher' });
    await user.click(within(dialog).getByRole('button', { name: 'Create publisher' }));
    await waitFor(() => expect(within(dialog).getByLabelText(/Name/)).toHaveFocus());
    cleanup();

    renderAt('/platform/publishers/p1?tab=team');
    await screen.findByRole('region', { name: 'Logins' });
    await user.click(screen.getByRole('button', { name: 'Invite a person' }));
    dialog = await screen.findByRole('dialog', { name: 'Invite a person' });
    await user.type(within(dialog).getByLabelText(/Email/), 'nope');
    await user.click(within(dialog).getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(within(dialog).getByLabelText(/Email/)).toHaveFocus());
    cleanup();

    renderAt('/platform/publishers/p1?tab=contract');
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Add rate' }));
    dialog = await screen.findByRole('dialog', { name: 'Add a commission rate' });
    await user.click(within(dialog).getByRole('button', { name: 'Add rate' }));
    await waitFor(() => expect(within(dialog).getByLabelText(/Rate/)).toHaveFocus());
  });
});

describe('Details form', () => {
  it('hints when a legacy publisher has no country', async () => {
    detail = { ...detail, publisher: { ...drita, country: null as unknown as string } };
    renderAt('/platform/publishers/p1');
    expect(await screen.findByText(/has no country yet/)).toBeInTheDocument();
  });

  it('says "Nothing to save" and sends no request when nothing changed', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers/p1');
    await screen.findByLabelText(/Name/);
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Nothing to save')).toBeInTheDocument();
    expect(sent('PATCH', '/admin/publishers/p1')).toHaveLength(0);
  });

  it('hides "Changes saved" as soon as the form is edited again', async () => {
    const user = userEvent.setup();
    renderAt('/platform/publishers/p1');
    const name = await screen.findByLabelText(/Name/);
    await user.type(name, 'x');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Name/), 'y');
    expect(screen.queryByText('Changes saved')).not.toBeInTheDocument();
  });
});
