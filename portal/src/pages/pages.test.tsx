import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metrics, SalesLine } from '../api/types';
import i18n from '../i18n';
import { formatMoney } from '../lib/format';
import EarningsPage from './EarningsPage';
import OverviewPage from './OverviewPage';
import SalesPage from './SalesPage';

const scope = vi.hoisted(() => ({
  value: {
    publisherId: undefined as string | undefined,
    setPublisherId: () => undefined,
    isAdmin: false,
    publishers: [] as Array<{ id: string; name: string }>,
  },
}));

vi.mock('../layout/PublisherScope', () => ({
  usePublisherScope: () => scope.value,
}));

function metrics(seed: number): Metrics {
  return {
    grossCents: 100_001 + seed,
    refundsCents: 2_002 + seed,
    taxCents: 3_003 + seed,
    feeCents: 4_004 + seed,
    netCents: 5_005 + seed,
    commissionAtSaleCents: 6_006 + seed,
    commissionReversedCents: 700 + seed,
    commissionCents: 7_007 + seed,
    unsplitCents: 8_008 + seed,
    earningsAtSaleCents: 9_009 + seed,
    earningsReversedCents: 1_010 + seed,
    earningsCents: 12_012 + seed,
    copies: 13 + seed,
    refundedCopies: 1,
  };
}

const totals = metrics(0);
const month1 = { periodStart: '2026-10-01', ...metrics(10_000) };
const month2 = { periodStart: '2026-11-01', ...metrics(20_000) };
const summary = { totals, series: [month1, month2] };
const byBook = { rows: [{ book: { id: 'b1', title: 'The Top Book' }, ...metrics(500) }] };
const byCountry = { rows: [{ country: 'AL', ...metrics(600) }] };

const pendingLine: SalesLine = {
  paidAt: '2026-11-02T10:00:00Z',
  transactionId: 't1',
  book: { id: 'b1', title: 'Pending Book' },
  country: 'AL',
  status: 'paid',
  unitPriceCents: 1_500,
  taxCents: 250,
  feeCents: null,
  commissionRateBps: null,
  commissionCents: 0,
  earningsCents: 0,
  refundedCents: 0,
  split: 'pending',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

function route(url: string): Response {
  if (url.includes('/reports/summary')) return json(200, summary);
  if (url.includes('/reports/by-book')) return json(200, byBook);
  if (url.includes('/reports/by-country')) return json(200, byCountry);
  if (url.includes('/reports/sales')) {
    return json(200, {
      lines: [pendingLine],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
    });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } });
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function renderPage(page: React.ReactNode, client = newClient()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>{page}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => route(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OverviewPage', () => {
  it('shows earnings from the backend totals and the top book', async () => {
    renderPage(<OverviewPage />);
    expect(await screen.findByText(formatMoney(totals.earningsCents, 'en'))).toBeInTheDocument();
    expect(await screen.findByText('The Top Book')).toBeInTheDocument();
  });

  it('shows the retry state when a request fails', async () => {
    fetchMock.mockImplementation(async () =>
      json(500, { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } }),
    );
    renderPage(<OverviewPage />);
    expect((await screen.findAllByRole('alert')).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });
});

describe('SalesPage', () => {
  it('labels pending lines and links the CSV in the current language', async () => {
    await i18n.changeLanguage('sq');
    renderPage(<SalesPage />);
    expect(await screen.findByText('Pending Book')).toBeInTheDocument();
    expect(screen.getByText('Tarifa në pritje')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eksporto CSV' })).toBeInTheDocument();
  });

  it('downloads the CSV through the API client with the credentials and portal header', async () => {
    await i18n.changeLanguage('sq');
    const createObjectURL = vi.fn(() => 'blob:csv');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/sales.csv')
        ? new Response('a,b\r\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
        : route(String(url)),
    );
    const user = userEvent.setup();
    renderPage(<SalesPage />);
    await screen.findByText('Pending Book');
    await user.click(screen.getByRole('button', { name: 'Eksporto CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/sales.csv'));
    expect(String(call?.[0])).toContain('lang=sq');
    expect(call?.[1]?.credentials).toBe('include');
    expect(new Headers(call?.[1]?.headers).get('X-Libraria-Portal')).toBe('1');
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });

  it('explains an export that is too large, in the current language', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/sales.csv')
        ? json(422, { error: { code: 'EXPORT_TOO_LARGE', message: 'raw english', requestId: 'r' } })
        : route(String(url)),
    );
    const user = userEvent.setup();
    renderPage(<SalesPage />);
    await screen.findByText('Pending Book');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Too many rows to export. Choose a shorter period or add filters.',
    );
    expect(alert).not.toHaveTextContent('raw english');
  });

  it('shows the English pending label', async () => {
    renderPage(<SalesPage />);
    expect(await screen.findByText('Fee pending')).toBeInTheDocument();
  });
});

describe('EarningsPage', () => {
  const rows: Array<[string, keyof Metrics]> = [
    ['Gross sales', 'grossCents'],
    ['− VAT', 'taxCents'],
    ['− Payment fees', 'feeCents'],
    ['= Net', 'netCents'],
    ['− Libraria commission', 'commissionAtSaleCents'],
    ['− Not yet split', 'unsplitCents'],
    ['= Earnings at sale', 'earningsAtSaleCents'],
    ['− Refund reversals', 'earningsReversedCents'],
    ['= Earnings', 'earningsCents'],
  ];

  it('shows each Metrics field unchanged in the by-month table', async () => {
    renderPage(<EarningsPage />);
    await screen.findByText('Gross sales');
    for (const [label, field] of rows) {
      const tr = screen.getByText(label).closest('tr') as HTMLElement;
      const cells = within(tr)
        .getAllByRole('cell')
        .map((c) => c.textContent);
      expect(cells).toEqual(
        [month1, month2, totals].map((m) => formatMoney(m[field] as number, 'en')),
      );
    }
    expect(screen.getByText(formatMoney(totals.refundsCents, 'en'))).toBeInTheDocument();
    expect(screen.getByText(/shown as at the time of sale/)).toBeInTheDocument();
  });

  it('switches to the by-book table', async () => {
    const user = userEvent.setup();
    renderPage(<EarningsPage />);
    await screen.findByText('Gross sales');
    await user.click(screen.getByRole('button', { name: 'By book' }));
    const row = (await screen.findByText('The Top Book')).closest('tr') as HTMLElement;
    // Same breakdown as the month view, every figure straight from Metrics.
    const fields: Array<keyof Metrics> = [
      'grossCents',
      'taxCents',
      'feeCents',
      'netCents',
      'commissionAtSaleCents',
      'unsplitCents',
      'earningsAtSaleCents',
      'earningsReversedCents',
      'earningsCents',
      'refundsCents',
    ];
    const cells = within(row)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    const m = byBook.rows[0];
    expect(cells).toEqual([
      String(m.copies),
      ...fields.map((f) => formatMoney(m[f] as number, 'en')),
    ]);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('− Libraria commission');
    expect(headers).toContain('− Refund reversals');
  });

  it('switches to the by-country table with the same breakdown', async () => {
    const user = userEvent.setup();
    renderPage(<EarningsPage />);
    await screen.findByText('Gross sales');
    await user.click(screen.getByRole('button', { name: 'By country' }));
    const row = (await screen.findByText('Albania')).closest('tr') as HTMLElement;
    const m = byCountry.rows[0];
    expect(within(row).getByText(formatMoney(m.commissionAtSaleCents, 'en'))).toBeInTheDocument();
    expect(within(row).getByText(formatMoney(m.earningsReversedCents, 'en'))).toBeInTheDocument();
  });
});

describe('admin scoping', () => {
  const adminScope = (publisherId: string | undefined) => {
    scope.value = { ...scope.value, isAdmin: true, publisherId };
  };
  const reportCalls = () =>
    fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/reports/'));

  it('asks the admin to pick a publisher and sends no requests', async () => {
    adminScope(undefined);
    renderPage(<OverviewPage />);
    expect(screen.getByText('Choose a publisher above to see its data.')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(reportCalls()).toHaveLength(0);
  });

  it('sends publisherId on report requests and in the CSV link', async () => {
    adminScope('pub-1');
    renderPage(<SalesPage />);
    expect(await screen.findByText('Pending Book')).toBeInTheDocument();
    expect(reportCalls().every((u) => u.includes('publisherId=pub-1'))).toBe(true);
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/sales.csv') ? json(500, {}) : route(String(url)),
    );
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url).includes('/sales.csv') && String(url).includes('publisherId=pub-1'),
        ),
      ).toBe(true),
    );
  });

  it('refetches for another publisher and resets filters', async () => {
    adminScope('pub-1');
    const user = userEvent.setup();
    const client = newClient();
    const view = renderPage(<SalesPage />, client);
    await screen.findByText('Pending Book');
    await user.selectOptions(screen.getByLabelText('Book'), 'b1');
    await waitFor(() =>
      expect(reportCalls().some((u) => u.includes('/sales?') && u.includes('bookId=b1'))).toBe(
        true,
      ),
    );
    fetchMock.mockClear();

    adminScope('pub-2');
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <SalesPage />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await waitFor(() => expect(reportCalls().length).toBeGreaterThan(0));
    const calls = reportCalls();
    expect(calls.every((u) => u.includes('publisherId=pub-2'))).toBe(true);
    expect(calls.some((u) => u.includes('bookId='))).toBe(false);
  });
});
