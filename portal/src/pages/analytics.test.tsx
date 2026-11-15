import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { Metrics } from '../api/types';
import i18n from '../i18n';
import { formatMoney } from '../lib/format';
import AnalyticsPage from './AnalyticsPage';

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
const day1 = metrics(10_000);
const day2 = metrics(20_000);
const summary = {
  totals,
  series: [
    { periodStart: '2026-10-01', ...day1 },
    { periodStart: '2026-10-02', ...day2 },
  ],
};
const bookRow = metrics(500);
const countryRow = metrics(600);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fetchMock = vi.fn();
function route(url: string): Response {
  if (url.includes('/reports/summary')) return json(200, summary);
  if (url.includes('/reports/by-book')) {
    return json(200, {
      rows: [
        {
          book: {
            id: 'b1',
            title: 'The Top Book',
            coverImageUrl: '/full-top.jpg',
            coverThumbUrl: '/thumb-top.jpg',
          },
          ...bookRow,
        },
      ],
    });
  }
  if (url.includes('/reports/by-country')) {
    return json(200, {
      rows: [
        { country: 'AL', ...countryRow },
        { country: null, ...metrics(0) },
      ],
    });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/analytics?from=2026-10-01&to=2026-11-01']}>
          <AnalyticsPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const cell = (name: string) => screen.findByRole('cell', { name });

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => route(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('Analytics', () => {
  it('Trends: shows each period exactly as the backend sent it', async () => {
    renderPage();
    expect(await cell(formatMoney(day1.grossCents, 'en'))).toBeInTheDocument();
    expect(await cell(formatMoney(day2.earningsCents, 'en'))).toBeInTheDocument();
    expect(await cell(String(day2.copies))).toBeInTheDocument();
    expect(await cell(formatMoney(day1.refundsCents, 'en'))).toBeInTheDocument();
  });

  it('Trends: switching granularity asks the API for it', async () => {
    const user = userEvent.setup();
    renderPage();
    await cell(formatMoney(day1.grossCents, 'en'));
    await user.click(screen.getByRole('radio', { name: 'Month' }));
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('granularity=month'))).toBe(
        true,
      ),
    );
  });

  it('Books: shows the book row unchanged', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Books' }));
    expect(await cell('The Top Book')).toBeInTheDocument();
    expect(await cell(formatMoney(bookRow.grossCents, 'en'))).toBeInTheDocument();
    expect(await cell(formatMoney(bookRow.earningsCents, 'en'))).toBeInTheDocument();
    expect(await cell(String(bookRow.copies))).toBeInTheDocument();
  });

  it('Books: shows each book thumbnail beside its title', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(screen.getByRole('tab', { name: 'Books' }));
    await cell('The Top Book');
    expect(container.querySelector('table img')?.getAttribute('src')).toBe('/thumb-top.jpg');
  });

  it('Financial: labels the per-period commission as net of reversals', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Financial' }));
    await cell(formatMoney(day1.commissionCents, 'en'));
    const table = screen.getByLabelText('Commission, fees, refunds and reversals by period');
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);
    expect(headers).toContain('Commission after reversals');
    expect(headers).not.toContain('Commission');
  });

  it('Countries: shows country rows, including unknown', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Countries' }));
    expect(await cell('Albania')).toBeInTheDocument();
    expect(await cell('Unknown')).toBeInTheDocument();
    expect(await cell(formatMoney(countryRow.grossCents, 'en'))).toBeInTheDocument();
  });

  it('Financial: shows commission, fees, refunds and reversals', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Financial' }));
    for (const cents of [
      totals.commissionAtSaleCents,
      totals.commissionReversedCents,
      totals.commissionCents,
      totals.feeCents,
      totals.taxCents,
      totals.refundsCents,
      totals.unsplitCents,
      totals.earningsReversedCents,
      day1.commissionCents,
      day2.feeCents,
    ]) {
      expect(await cell(formatMoney(cents, 'en'))).toBeInTheDocument();
    }
  });

  it('shows a retry when the data fails to load', async () => {
    fetchMock.mockImplementation(async () =>
      json(500, { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } }),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('has no axe violations on any tab', async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await cell(formatMoney(day1.grossCents, 'en'));
    expect(await axe(container)).toHaveNoViolations();
    for (const name of ['Books', 'Countries', 'Financial']) {
      await user.click(screen.getByRole('tab', { name }));
      await within(container).findByRole('tabpanel');
      await screen.findAllByRole('cell');
      expect(await axe(container)).toHaveNoViolations();
    }
  });
});
