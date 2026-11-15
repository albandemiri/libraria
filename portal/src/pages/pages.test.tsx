import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metrics, SalesLine } from '../api/types';
import i18n from '../i18n';
import { formatMoney } from '../lib/format';
import OverviewPage from './OverviewPage';

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
  itemId: 'i1',
  refundedAt: null,
  book: { id: 'b1', title: 'Pending Book' },
  country: 'AL',
  status: 'paid',
  unitPriceCents: 1_500,
  taxCents: 250,
  feeCents: null,
  commissionRateBps: null,
  commissionCents: 0,
  earningsCents: 0,
  commissionAtSaleCents: 0,
  commissionReversedCents: 0,
  earningsAtSaleCents: 0,
  earningsReversedCents: 0,
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

describe('admin scoping', () => {
  const adminScope = (publisherId: string | undefined) => {
    scope.value = { ...scope.value, isAdmin: true, publisherId };
  };
  const reportCalls = () =>
    fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('/reports/'));

  it('asks the admin to pick a publisher and sends no requests', async () => {
    adminScope(undefined);
    renderPage(<OverviewPage />);
    expect(
      screen.getByText('Choose a publisher in the sidebar to see its data.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
    expect(reportCalls()).toHaveLength(0);
  });

  it('sends publisherId on every report request', async () => {
    adminScope('pub-1');
    renderPage(<OverviewPage />);
    expect(await screen.findByText('The Top Book')).toBeInTheDocument();
    expect(reportCalls().length).toBeGreaterThan(0);
    expect(reportCalls().every((u) => u.includes('publisherId=pub-1'))).toBe(true);
  });
});
