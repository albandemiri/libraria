import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { Metrics } from '../api/types';
import i18n from '../i18n';
import { formatMoney } from '../lib/format';
import EarningsPage from './EarningsPage';
import PayoutsPage from './PayoutsPage';
import StatementsPage from './StatementsPage';

expect.extend(axeMatchers);
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const scope = vi.hoisted(() => ({
  value: {
    publisherId: undefined as string | undefined,
    setPublisherId: (_id: string): void => undefined,
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
const month1 = { periodStart: '2026-10-01', ...metrics(10_000) };
const month2 = { periodStart: '2026-11-01', ...metrics(20_000) };
const byBook = { rows: [{ book: { id: 'b1', title: 'The Top Book' }, ...metrics(500) }] };
const byCountry = { rows: [{ country: 'AL', ...metrics(600) }] };

/** A deterministic, distinct set of figures for each statement period. */
const seedFor = (from: string, to: string) =>
  Number(`${from}${to}`.replaceAll('-', '')) % 8_000_000;
const periodMetrics = (from: string, to: string) => metrics(seedFor(from, to));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
let csvTooLargeFor: string[] = [];

function route(url: string): Response {
  const u = new URL(url, 'http://x');
  const from = u.searchParams.get('from') ?? '';
  const to = u.searchParams.get('to') ?? '';
  if (u.pathname.endsWith('/reports/summary')) {
    if (
      u.searchParams.get('granularity') === 'month' &&
      from === '2026-10-01' &&
      to === '2026-12-01'
    ) {
      // Earnings page range
      return json(200, { totals, series: [month1, month2] });
    }
    // A whole-year request carries one bucket per month; anything else has no series.
    const series = [];
    if (from.endsWith('-01-01') && to === `${Number(from.slice(0, 4)) + 1}-01-01`) {
      for (let m = 0; m < 12; m++) {
        const a = new Date(Date.UTC(Number(from.slice(0, 4)), m, 1)).toISOString().slice(0, 10);
        const b = new Date(Date.UTC(Number(from.slice(0, 4)), m + 1, 1)).toISOString().slice(0, 10);
        series.push({ periodStart: a, ...periodMetrics(a, b) });
      }
    }
    return json(200, { totals: periodMetrics(from, to), series });
  }
  if (u.pathname.endsWith('/reports/by-book')) return json(200, byBook);
  if (u.pathname.endsWith('/reports/by-country')) return json(200, byCountry);
  if (u.pathname.endsWith('/reports/sales.csv')) {
    if (csvTooLargeFor.includes(from)) {
      return json(422, {
        error: { code: 'EXPORT_TOO_LARGE', message: 'raw english', requestId: 'r' },
      });
    }
    return new Response('a\r\n', { status: 200 });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } });
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const RANGE = 'from=2026-10-01&to=2026-12-01';

function renderAt(page: React.ReactNode, entry: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={newClient()}>
        <MemoryRouter initialEntries={[entry]}>{page}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const sent = (path: string) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(path));
const paramsOf = (url: string) => new URL(url, 'http://x').searchParams;

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  csvTooLargeFor = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => route(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** jsdom has no object URLs; give it stubs, then spy so restoreAllMocks cleans up. */
function mockDownloads() {
  const url = URL as unknown as Record<string, unknown>;
  url.createObjectURL ??= () => '';
  url.revokeObjectURL ??= () => undefined;
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:csv');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
}

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

  it('shows each Metrics field unchanged in the financial summary, with a one-line explanation', async () => {
    renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    const ledger = await screen.findByRole('table', { name: 'Financial summary statement' });
    for (const [label, field] of rows) {
      const tr = within(ledger).getByText(label).closest('tr') as HTMLElement;
      expect(within(tr).getByText(formatMoney(totals[field] as number, 'en'))).toBeInTheDocument();
      // label, explanation, amount, link
      expect(
        within(tr).getAllByRole('cell').length + within(tr).getAllByRole('rowheader').length,
      ).toBe(4);
    }
    expect(within(ledger).getByText(formatMoney(totals.refundsCents, 'en'))).toBeInTheDocument();
  });

  it('links every row to the transactions with the same range', async () => {
    renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    const ledger = await screen.findByRole('table', { name: 'Financial summary statement' });
    const links = within(ledger).getAllByRole('link', { name: /View transactions/ });
    expect(links.length).toBeGreaterThanOrEqual(rows.length);
    for (const link of links) {
      expect(link).toHaveAttribute('href', `/transactions?${RANGE}`);
    }
  });

  it('shows each Metrics field unchanged in the by-month waterfall, with totals', async () => {
    renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    const region = await screen.findByRole('region', { name: 'Earnings by month' });
    for (const [label, field] of rows) {
      const tr = within(region)
        .getByRole('rowheader', { name: label })
        .closest('tr') as HTMLElement;
      const cells = within(tr)
        .getAllByRole('cell')
        .map((c) => c.textContent);
      expect(cells).toEqual(
        [month1, month2, totals].map((m) => formatMoney(m[field] as number, 'en')),
      );
    }
    const info = within(region)
      .getByText(/Refunded to readers \(information only/)
      .closest('tr') as HTMLElement;
    expect(within(info).getByText(formatMoney(totals.refundsCents, 'en'))).toBeInTheDocument();
    expect(screen.getByText(/shown as at the time of sale/)).toBeInTheDocument();
  });

  it('switches to the by-book view with the same breakdown', async () => {
    const user = userEvent.setup();
    renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    await screen.findByRole('region', { name: 'Earnings by month' });
    await user.click(screen.getByRole('radio', { name: 'By book' }));
    const region = await screen.findByRole('region', { name: 'Earnings by book' });
    const row = within(region)
      .getByRole('rowheader', { name: 'The Top Book' })
      .closest('tr') as HTMLElement;
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
    const m = byBook.rows[0];
    expect(
      within(row)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual([String(m.copies), ...fields.map((f) => formatMoney(m[f] as number, 'en'))]);
  });

  it('switches to the by-country view', async () => {
    const user = userEvent.setup();
    renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    await screen.findByRole('region', { name: 'Earnings by month' });
    await user.click(screen.getByRole('radio', { name: 'By country' }));
    const region = await screen.findByRole('region', { name: 'Earnings by country' });
    const row = within(region)
      .getByRole('rowheader', { name: 'Albania' })
      .closest('tr') as HTMLElement;
    const m = byCountry.rows[0];
    expect(within(row).getByText(formatMoney(m.commissionAtSaleCents, 'en'))).toBeInTheDocument();
    expect(within(row).getByText(formatMoney(m.earningsReversedCents, 'en'))).toBeInTheDocument();
  });

  it('shows balances as not set up, with no figures, and links to the statements', async () => {
    renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    await screen.findByRole('table', { name: 'Financial summary statement' });
    const balances = screen.getByRole('region', { name: 'Balances' });
    for (const name of ['Pending balance', 'Available balance', 'Paid out']) {
      expect(within(balances).getByRole('heading', { name: name })).toBeInTheDocument();
    }
    expect(balances.textContent).not.toMatch(/\d/);
    expect(screen.getByRole('link', { name: /Statements/ })).toHaveAttribute('href', '/statements');
  });

  it('shows one error, not two, when the summary fails', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/reports/summary')
        ? json(500, { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } })
        : route(String(url)),
    );
    renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    expect(await screen.findAllByRole('alert')).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAt(<EarningsPage />, `/earnings?${RANGE}`);
    await screen.findByRole('region', { name: 'Earnings by month' });
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PayoutsPage', () => {
  it('explains what will appear and shows no figures or requests', async () => {
    const { container } = renderAt(<PayoutsPage />, '/payouts');
    expect(screen.getByRole('heading', { level: 1, name: 'Payouts' })).toBeInTheDocument();
    expect(screen.getByText(/earnings are recorded/i)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d/);
    expect(sent('/reports/')).toHaveLength(0);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('StatementsPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
  });

  const monthRow = (name: RegExp | string) => screen.findByRole('row', { name });
  const pairs = (path = '/reports/summary') =>
    sent(path).map((u) => `${paramsOf(u).get('from')}|${paramsOf(u).get('to')}`);

  it('loads the whole year with one /summary call and reads each month from its bucket', async () => {
    renderAt(<StatementsPage />, '/statements');
    const feb = await monthRow(/Feb 2026/);
    const m = periodMetrics('2026-02-01', '2026-03-01');
    expect(await within(feb).findByText(formatMoney(m.grossCents, 'en'))).toBeInTheDocument();
    expect(within(feb).getByText(formatMoney(m.earningsCents, 'en'))).toBeInTheDocument();
    // One call for the year, month granularity; not one per month.
    expect(pairs()).toEqual(['2026-01-01|2027-01-01']);
    expect(paramsOf(sent('/reports/summary')[0]).get('granularity')).toBe('month');
    // No future month.
    expect(screen.queryByRole('row', { name: /Dec 2026/ })).not.toBeInTheDocument();
    expect(await monthRow(/Jan 2026/)).toBeInTheDocument();
    expect(await monthRow(/Nov 2026/)).toBeInTheDocument();
  });

  it('shows one error with a retry above the table when the year fails to load', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/reports/summary')
        ? json(500, { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } })
        : route(String(url)),
    );
    renderAt(<StatementsPage />, '/statements');
    expect(await screen.findAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    // The CSV downloads stay usable.
    expect(
      within(await monthRow(/Nov 2026/)).getByRole('button', { name: /Download CSV/ }),
    ).toBeEnabled();
  });

  it('labels only the current month "in progress"', async () => {
    renderAt(<StatementsPage />, '/statements');
    const nov = await monthRow(/Nov 2026/);
    expect(within(nov).getByText('In progress')).toBeInTheDocument();
    const oct = await monthRow(/Oct 2026/);
    expect(within(oct).queryByText('In progress')).not.toBeInTheDocument();
  });

  it('decides the current month in UTC, at the month boundary', async () => {
    vi.setSystemTime(new Date('2026-11-30T23:30:00Z'));
    const first = renderAt(<StatementsPage />, '/statements');
    expect(within(await monthRow(/Nov 2026/)).getByText('In progress')).toBeInTheDocument();
    first.unmount();
    vi.setSystemTime(new Date('2026-12-01T00:30:00Z'));
    renderAt(<StatementsPage />, '/statements');
    const dec = await monthRow(/Dec 2026/);
    expect(within(dec).getByText('In progress')).toBeInTheDocument();
    expect(within(await monthRow(/Nov 2026/)).queryByText('In progress')).not.toBeInTheDocument();
  });

  it('downloads exactly that month as CSV', async () => {
    const click = mockDownloads();
    const user = userEvent.setup();
    renderAt(<StatementsPage />, '/statements');
    const oct = await monthRow(/Oct 2026/);
    await user.click(within(oct).getByRole('button', { name: /Download CSV/ }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const p = paramsOf(sent('/reports/sales.csv')[0]);
    expect(p.get('from')).toBe('2026-10-01');
    expect(p.get('to')).toBe('2026-11-01');
  });

  it('changes year, and a past year has no in-progress month', async () => {
    const user = userEvent.setup();
    renderAt(<StatementsPage />, '/statements');
    await monthRow(/Nov 2026/);
    await user.selectOptions(screen.getByLabelText('Year'), '2025');
    const dec = await monthRow(/Dec 2025/);
    expect(within(dec).queryByText('In progress')).not.toBeInTheDocument();
    expect(screen.queryByText('In progress')).not.toBeInTheDocument();
    expect(pairs()).toContain('2025-01-01|2026-01-01');
  });

  it('ignores a hand-edited year and view', async () => {
    renderAt(<StatementsPage />, '/statements?year=1999&view=x');
    expect(await monthRow(/Nov 2026/)).toBeInTheDocument();
    expect(screen.getByLabelText('Year')).toHaveValue('2026');
    expect(pairs()).toEqual(['2026-01-01|2027-01-01']);
    expect(screen.getByRole('radio', { name: 'Monthly' })).toBeChecked();
  });

  it('accepts only whole years', async () => {
    renderAt(<StatementsPage />, '/statements?year=2025.0');
    expect(await monthRow(/Nov 2026/)).toBeInTheDocument();
  });

  it('annual rows each make their own year call and show the backend totals', async () => {
    const user = userEvent.setup();
    renderAt(<StatementsPage />, '/statements?year=2025');
    await monthRow(/Dec 2025/);
    fetchMock.mockClear();
    await user.click(screen.getByRole('radio', { name: 'Annual' }));
    const row = await screen.findByRole('row', { name: /2025/ });
    const m = periodMetrics('2025-01-01', '2026-01-01');
    expect(await within(row).findByText(formatMoney(m.grossCents, 'en'))).toBeInTheDocument();
    expect(within(row).getByText(formatMoney(m.earningsCents, 'en'))).toBeInTheDocument();
    const calls = sent('/reports/summary').map(paramsOf);
    const own = calls.filter((p) => p.get('from') === '2025-01-01' && p.get('to') === '2026-01-01');
    expect(own).toHaveLength(1);
    expect(own[0].get('granularity')).toBe('month');
    expect(calls.some((p) => p.get('from') === '2026-01-01' && p.get('to') === '2027-01-01')).toBe(
      true,
    );
    const current = screen.getByRole('row', { name: /2026/ });
    expect(within(current).getByText('In progress')).toBeInTheDocument();
    // The year belongs to the monthly view, so annual drops it from the URL.
    expect(screen.queryByLabelText('Year')).not.toBeInTheDocument();
  });

  it('shows the too-large message and weekly downloads on that month only', async () => {
    csvTooLargeFor = ['2026-03-01'];
    const click = mockDownloads();
    const user = userEvent.setup();
    renderAt(<StatementsPage />, '/statements');
    const mar = await monthRow(/Mar 2026/);
    const button = within(mar).getByRole('button', { name: /Download CSV/ });
    await user.click(button);
    const alert = await within(mar).findByRole('alert');
    expect(alert).toHaveTextContent(/too many rows/i);
    expect(alert).not.toHaveTextContent('raw english');
    // The failure message takes focus.
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    // Other rows are unaffected.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(await monthRow(/Feb 2026/)).queryByRole('alert')).not.toBeInTheDocument();
    // March in weeks: 1-7, 8-14, 15-21, 22-28, 29-31.
    const weeks = within(mar).getAllByRole('button', { name: /^Download CSV: / });
    expect(weeks).toHaveLength(5);
    await user.click(weeks[1]);
    await waitFor(() => expect(click).toHaveBeenCalled());
    const csv = sent('/reports/sales.csv').map(paramsOf);
    expect(csv[csv.length - 1].get('from')).toBe('2026-03-08');
    expect(csv[csv.length - 1].get('to')).toBe('2026-03-15');
    await user.click(weeks[4]);
    await waitFor(() => expect(sent('/reports/sales.csv')).toHaveLength(3));
    const final = paramsOf(sent('/reports/sales.csv')[2]);
    expect(final.get('from')).toBe('2026-03-29');
    expect(final.get('to')).toBe('2026-04-01');
  });

  it('offers a too-large year as its months', async () => {
    csvTooLargeFor = ['2025-01-01'];
    const click = mockDownloads();
    const user = userEvent.setup();
    renderAt(<StatementsPage />, '/statements?view=annual');
    const row = await screen.findByRole('row', { name: /2025/ });
    await user.click(within(row).getByRole('button', { name: /Download CSV/ }));
    expect(await within(row).findByRole('alert')).toHaveTextContent(/this year/i);
    const months = within(row).getAllByRole('button', { name: /^Download CSV: / });
    expect(months).toHaveLength(12);
    expect(months[0]).toHaveAccessibleName('Download CSV: Jan 2025');
    await user.click(months[2]);
    await waitFor(() => expect(click).toHaveBeenCalled());
    const last = paramsOf(sent('/reports/sales.csv').at(-1) as string);
    expect(last.get('from')).toBe('2025-03-01');
    expect(last.get('to')).toBe('2025-04-01');
  });

  it('keeps focus on the button while a download runs and ignores a second click', async () => {
    mockDownloads();
    let release: (r: Response) => void = () => undefined;
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/sales.csv')
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : route(String(url)),
    );
    const user = userEvent.setup();
    renderAt(<StatementsPage />, '/statements');
    const button = within(await monthRow(/Oct 2026/)).getByRole('button', { name: /Download CSV/ });
    await user.click(button);
    await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'true'));
    expect(button).toHaveFocus();
    await user.click(button);
    expect(sent('/reports/sales.csv')).toHaveLength(1);
    release(new Response('a\r\n', { status: 200 }));
    await waitFor(() => expect(button).not.toHaveAttribute('aria-disabled'));
  });

  it('sends the admin publisherId on the summary and CSV requests', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'pub-1' };
    mockDownloads();
    const user = userEvent.setup();
    renderAt(<StatementsPage />, '/statements');
    const oct = await monthRow(/Oct 2026/);
    await user.click(within(oct).getByRole('button', { name: /Download CSV/ }));
    await waitFor(() => expect(sent('/reports/sales.csv')).toHaveLength(1));
    for (const url of [...sent('/reports/summary'), ...sent('/reports/sales.csv')]) {
      expect(paramsOf(url).get('publisherId')).toBe('pub-1');
    }
  });

  it('notes that PDF is coming later, and has no accessibility violations', async () => {
    const { container } = renderAt(<StatementsPage />, '/statements');
    await monthRow(/Nov 2026/);
    expect(screen.getByText(/PDF statements are coming later/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('asks an admin to pick a publisher first and sends no request', () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: undefined };
    renderAt(<StatementsPage />, '/statements');
    expect(screen.getByText('Choose a publisher in the sidebar to see its data.')).toBeVisible();
    expect(sent('/reports/')).toHaveLength(0);
  });
});
