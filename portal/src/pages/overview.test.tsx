import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { Metrics, SalesLine } from '../api/types';
import i18n from '../i18n';
import { formatChange, formatMoney } from '../lib/format';
import OverviewPage from './OverviewPage';

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
const zero = Object.fromEntries(Object.keys(metrics(0)).map((k) => [k, 0])) as unknown as Metrics;

const totals = metrics(0);
const summary = { totals, series: [{ periodStart: '2026-10-01', ...metrics(10_000) }] };
const byBook = {
  rows: [
    {
      book: {
        id: 'b1',
        title: 'The Top Book',
        coverImageUrl: '/full-top.jpg',
        coverThumbUrl: '/thumb-top.jpg',
      },
      ...metrics(500),
    },
  ],
};

function line(over: Partial<SalesLine>): SalesLine {
  return {
    paidAt: '2026-10-20T10:00:00Z',
    transactionId: 't1',
    itemId: 'i1',
    refundedAt: null,
    book: { id: 'b1', title: 'Sold Book' },
    country: 'AL',
    status: 'paid',
    unitPriceCents: 1_500,
    taxCents: 250,
    feeCents: 40,
    commissionRateBps: 2000,
    commissionCents: 200,
    earningsCents: 900,
    commissionAtSaleCents: 200,
    commissionReversedCents: 0,
    earningsAtSaleCents: 900,
    earningsReversedCents: 0,
    refundedCents: 0,
    split: 'done',
    ...over,
  };
}
const sale = line({});
const refund = line({
  transactionId: 't2',
  itemId: 'i2',
  book: { id: 'b3', title: 'Refunded Book' },
  status: 'refunded',
  paidAt: '2026-10-10T10:00:00Z',
  refundedAt: '2026-10-25T09:00:00Z',
  refundedCents: 1_500,
});

const baseBook = {
  publisherId: 'p1',
  author: 'A',
  isbn13: null,
  description: null,
  genre: 'Fiction',
  language: 'en',
  price: { amountCents: 999, currency: 'EUR' },
  coverImageUrl: null,
  coverThumbUrl: null,
  publishedAt: null,
  isAvailable: false,
  mediaType: 'ebook',
  durationSeconds: null,
  hasAsset: false,
  fileSizeBytes: null,
  metrics: { salesCount: 0, totalRevenueCents: 0, earningsCents: 0 },
  createdAt: '2026-09-01T00:00:00Z',
};
const books = [
  {
    ...baseBook,
    id: 'b2',
    title: 'Updated Book',
    status: 'published',
    latestAsset: { state: 'ready', reasonCode: null },
    updatedAt: '2026-10-22T08:00:00Z',
  },
  {
    ...baseBook,
    id: 'b4',
    title: 'Rejected Book',
    coverImageUrl: '/full-rejected.jpg',
    coverThumbUrl: '/thumb-rejected.jpg',
    status: 'draft',
    latestAsset: { state: 'rejected', reasonCode: 'NOT_AN_EPUB' },
    updatedAt: '2026-10-01T08:00:00Z',
  },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
let previousTotals: Metrics = zero;
function route(url: string): Response {
  if (url.includes('/reports/summary')) {
    // The previous period starts on 2026-08-31.
    return json(
      200,
      url.includes('from=2026-08-31') ? { totals: previousTotals, series: [] } : summary,
    );
  }
  if (url.includes('/reports/by-book')) return json(200, byBook);
  if (url.includes('/reports/sales')) {
    const lines = url.includes('status=refunded')
      ? [refund]
      : url.includes('status=')
        ? []
        : [sale];
    return json(200, {
      lines,
      pagination: { page: 1, limit: 8, total: lines.length, totalPages: 1 },
    });
  }
  if (url.includes('/publisher/books')) {
    const total = url.includes('status=draft') ? 25 : books.length;
    return json(200, {
      books,
      pagination: { page: 1, limit: 10, total, totalPages: 1 },
    });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/?from=2026-10-01&to=2026-11-01']}>
          <OverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  previousTotals = zero;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => route(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

describe('Overview', () => {
  it('shows the earnings hero with its meaning, and the four figures', async () => {
    renderPage();
    const hero = await screen.findByTestId('hero');
    expect(within(hero).getByText(formatMoney(totals.earningsCents, 'en'))).toBeInTheDocument();
    expect(
      within(hero).getByText('Net publisher earnings, after VAT, fees, commission and refunds'),
    ).toBeInTheDocument();
    const figures = await screen.findByRole('group', { name: 'Key figures' });
    for (const cents of [totals.grossCents, totals.refundsCents, totals.commissionCents]) {
      expect(within(figures).getByText(formatMoney(cents, 'en'))).toBeInTheDocument();
    }
    expect(within(figures).getByText(String(totals.copies))).toBeInTheDocument();
    // The figure is the net commission (after reversals), so it carries that wording.
    expect(within(figures).getByText('Commission after reversals')).toBeInTheDocument();
    expect(within(figures).queryByText('Libraria commission')).toBeNull();
  });

  it('shows each top book thumbnail', async () => {
    const { container } = renderPage();
    await screen.findByText('The Top Book');
    expect(container.querySelector('img[src="/thumb-top.jpg"]')).not.toBeNull();
  });

  it('says so, instead of a percentage, when the previous period had no sales', async () => {
    renderPage();
    const figures = await screen.findByRole('group', { name: 'Key figures' });
    expect((await within(figures).findAllByText('No sales in the previous period')).length).toBe(4);
    expect(within(figures).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('compares each figure with the previous period when it had sales', async () => {
    previousTotals = { ...metrics(0), grossCents: 50_000, copies: 26, refundsCents: 0 };
    renderPage();
    const figures = await screen.findByRole('group', { name: 'Key figures' });
    // Gross went from 50,000 to 100,001 cents: an increase, with an explicit sign.
    const up = `${formatChange((100_001 - 50_000) / 50_000, 'en')} vs previous period`;
    expect(up).toMatch(/^\+/);
    expect(await within(figures).findByText(up)).toBeInTheDocument();
    // Copies went from 26 to 13: a decrease.
    const down = `${formatChange(-0.5, 'en')} vs previous period`;
    expect(down).toMatch(/^[-−]50%/);
    expect(within(figures).getByText(down)).toBeInTheDocument();
    // Refunds were zero before: neutral text, not "no sales" and not a percentage.
    expect(within(figures).getByText('None in the previous period')).toBeInTheDocument();
    expect(within(figures).queryByText('No sales in the previous period')).not.toBeInTheDocument();
  });

  it('notes the amount not yet split under the hero', async () => {
    renderPage();
    const hero = await screen.findByTestId('hero');
    expect(
      within(hero).getByText(
        `Excludes ${formatMoney(totals.unsplitCents, 'en')} not yet split (no contract rate, or payment fee pending)`,
      ),
    ).toBeInTheDocument();
  });

  it('lists full refunds only, with no partial-refund request', async () => {
    renderPage();
    await screen.findByText('Refunded Book');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('partially_refunded'))).toBe(
      false,
    );
  });

  it('says how many more drafts there are, linking to the catalogue filter', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'and 23 more drafts' });
    expect(link).toHaveAttribute('href', '/catalog?status=draft');
  });

  it('uses the thumbnail for the cover in the action list', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /Rejected Book/ });
    const row = link.closest('li') as HTMLElement;
    expect(row.querySelector('img')?.getAttribute('src')).toBe('/thumb-rejected.jpg');
  });

  it('shows the payouts block as not set up, with no digits', async () => {
    renderPage();
    const block = await screen.findByRole('region', { name: 'Payouts' });
    expect(block.textContent).not.toMatch(/\d/);
    expect(within(block).getByText(/not set up/i)).toBeInTheDocument();
  });

  it('lists the top books with their exact figures', async () => {
    renderPage();
    const top = await screen.findByRole('region', { name: 'Top 5 books' });
    expect(await within(top).findByText('The Top Book')).toBeInTheDocument();
    expect(within(top).getByText(formatMoney(100_501, 'en'))).toBeInTheDocument();
  });

  it('merges sales, refunds and book updates by timestamp, newest first', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Activity in this period' });
    await within(list).findByText('Refunded Book');
    const text = within(list)
      .getAllByRole('listitem')
      .map((i) => i.textContent ?? '');
    const at = (title: string) => text.findIndex((t) => t.includes(title));
    expect(at('Refunded Book')).toBeGreaterThanOrEqual(0);
    expect(at('Refunded Book')).toBeLessThan(at('Updated Book'));
    expect(at('Updated Book')).toBeLessThan(at('Sold Book'));
    expect(text[at('Refunded Book')]).toContain('Refund');
    expect(text[at('Updated Book')]).toContain('Book updated');
  });

  it('flags a book whose latest upload was rejected, linking to it', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Needs your attention' });
    const link = await within(list).findByRole('link', { name: /Rejected Book/ });
    expect(link).toHaveAttribute('href', '/catalog/b4');
    expect(link.closest('li')).toHaveTextContent('The latest upload was rejected');
    expect(within(list).queryByText(/Updated Book/)).not.toBeInTheDocument();
  });

  it('ignores archived books in the action list, even with a rejected upload', async () => {
    books.push({
      ...baseBook,
      id: 'b9',
      title: 'Archived Draft',
      status: 'archived',
      latestAsset: { state: 'rejected', reasonCode: 'NOT_AN_EPUB' },
      updatedAt: '2026-10-02T08:00:00Z',
    } as unknown as (typeof books)[number]);
    try {
      renderPage();
      const list = await screen.findByRole('list', { name: 'Needs your attention' });
      await within(list).findByRole('link', { name: /Rejected Book/ });
      expect(within(list).queryByText(/Archived Draft/)).not.toBeInTheDocument();
    } finally {
      books.pop();
    }
  });

  it('toggles the exact values under the chart', async () => {
    const user = userEvent.setup();
    renderPage();
    const toggle = await screen.findByRole('button', { name: 'Show exact values' });
    expect(screen.queryByRole('region', { name: 'Exact values' })).not.toBeInTheDocument();
    await user.click(toggle);
    const table = await screen.findByRole('region', { name: 'Exact values' });
    expect(
      within(table).getByRole('cell', { name: formatMoney(100_001 + 10_000, 'en') }),
    ).toBeInTheDocument();
  });

  it('retries a failed section instead of breaking the page', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/by-book')
        ? json(500, { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } })
        : route(String(url)),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(await screen.findByTestId('hero')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderPage();
    await screen.findByText('The Top Book');
    await screen.findByRole('link', { name: /Rejected Book/ });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Overview list rows', () => {
  it('give rows inner horizontal padding of var(--s-4), and the empty note a card', async () => {
    // CSS modules are not processed under test, so read the stylesheet itself. The portal has
    // no Node typings, and vitest runs in Node, so the import is untyped.
    // @ts-expect-error no Node typings in the portal
    const { readFileSync } = await import('node:fs');
    const css: string = readFileSync('src/pages/Page.module.css', 'utf8');
    const has = (name: string) =>
      new RegExp(String.raw`\.${name}\s*\{[^}]*padding[^;]*var\(--s-4\)`).test(css);
    expect(has('item')).toBe(true);
    expect(has('emptyCard')).toBe(true);
  });
});
