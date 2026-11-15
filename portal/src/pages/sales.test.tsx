import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import type { SalesLine } from '../api/types';
import i18n from '../i18n';
import { formatDateTime, formatMoney, formatPercentBps } from '../lib/format';
import { useDateRange } from '../lib/useDateRange';
import { PublisherSelect } from '../layout/PublisherSelect';
import SalesOrdersPage from './SalesOrdersPage';
import TransactionsPage from './TransactionsPage';

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

const BOOK_A = '11111111-1111-4111-8111-111111111111';
const BOOK_B = '22222222-2222-4222-8222-222222222222';
const TX1 = 'aaaa1111-0000-4000-8000-000000000001';
const TX2 = 'bbbb2222-0000-4000-8000-000000000002';

const doneLine: SalesLine = {
  paidAt: '2026-11-02T10:00:00Z',
  transactionId: TX1,
  itemId: 'item-1',
  refundedAt: null,
  book: { id: BOOK_A, title: 'The First Book' },
  country: 'AL',
  status: 'paid',
  unitPriceCents: 1_299,
  taxCents: 217,
  feeCents: 41,
  commissionRateBps: 2_000,
  commissionCents: 200,
  earningsCents: 841,
  commissionAtSaleCents: 200,
  commissionReversedCents: 0,
  earningsAtSaleCents: 841,
  earningsReversedCents: 0,
  refundedCents: 0,
  split: 'done',
};
const refundedLine: SalesLine = {
  ...doneLine,
  itemId: 'item-2',
  refundedAt: '2026-11-03T12:30:00Z',
  book: { id: BOOK_B, title: 'The Second Book' },
  status: 'partially_refunded',
  unitPriceCents: 2_450,
  taxCents: 408,
  feeCents: 73,
  commissionRateBps: 1_500,
  commissionCents: 123,
  earningsCents: 777,
  commissionAtSaleCents: 307,
  commissionReversedCents: 184,
  earningsAtSaleCents: 1_662,
  earningsReversedCents: 885,
  refundedCents: 1_001,
};
const pendingLine: SalesLine = {
  ...doneLine,
  transactionId: TX2,
  itemId: 'item-3',
  book: { id: BOOK_A, title: 'Pending Book' },
  feeCents: null,
  commissionRateBps: null,
  commissionCents: 0,
  earningsCents: 0,
  commissionAtSaleCents: 0,
  earningsAtSaleCents: 0,
  split: 'pending',
};

const pagination = { page: 1, limit: 25, total: 1, totalPages: 1 };
const orders = [
  { transactionId: TX1, paidAt: doneLine.paidAt, lines: [doneLine, refundedLine] },
  { transactionId: TX2, paidAt: pendingLine.paidAt, lines: [pendingLine] },
];
const byBook = {
  rows: [
    { book: { id: BOOK_A, title: 'The First Book' } },
    { book: { id: BOOK_B, title: 'The Second Book' } },
  ],
};
const byCountry = { rows: [{ country: 'AL' }, { country: null }] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn();
let ordersData: typeof orders = orders;
let ordersPagination = pagination;
let salesPagination = pagination;

function route(url: string): Response {
  if (url.includes('/reports/orders')) {
    return json(200, { orders: ordersData, pagination: ordersPagination });
  }
  if (url.includes('/reports/sales.csv')) return new Response('a\r\n', { status: 200 });
  if (url.includes('/reports/sales')) {
    return json(200, { lines: [doneLine, refundedLine, pendingLine], pagination: salesPagination });
  }
  if (url.includes('/reports/by-book')) return json(200, byBook);
  if (url.includes('/reports/by-country')) return json(200, byCountry);
  return json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } });
}

const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const RANGE = 'from=2026-11-01&to=2026-12-01';

function renderAt(page: React.ReactNode, entry = `/x?${RANGE}`, client = newClient()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[entry]}>{page}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** A row of the page's table (book titles also appear as filter options, so scope to the table). */
async function rowOf(tableName: string, text: string): Promise<HTMLElement> {
  const table = await screen.findByRole('region', { name: tableName });
  return within(table).getByText(text).closest('tr') as HTMLElement;
}

function ChangeRange() {
  const { setRange } = useDateRange();
  return (
    <button type="button" onClick={() => setRange({ from: '2026-05-01', to: '2026-06-01' })}>
      change range
    </button>
  );
}

function Switcher() {
  const [id, setId] = useState('pub-1');
  scope.value = {
    ...scope.value,
    isAdmin: true,
    publisherId: id,
    setPublisherId: setId,
    publishers: [
      { id: 'pub-1', name: 'One' },
      { id: 'pub-2', name: 'Two' },
    ],
  };
  return (
    <>
      <PublisherSelect />
      <SalesOrdersPage />
    </>
  );
}

function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      go back
    </button>
  );
}

const sent = (path: string) =>
  fetchMock.mock.calls.map(([u]) => String(u)).filter((u) => u.includes(path));
const lastParams = (path: string) => {
  const urls = sent(path);
  return new URL(urls[urls.length - 1] ?? 'http://x/', 'http://x').searchParams;
};

beforeEach(async () => {
  ordersData = orders;
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  ordersPagination = pagination;
  salesPagination = pagination;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => route(String(url)));
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SalesOrdersPage', () => {
  it('lists one row per order with books, per-line status badges and per-line amounts', async () => {
    renderAt(<SalesOrdersPage />);
    const rows = await screen.findAllByRole('row');
    // header + two orders
    expect(rows).toHaveLength(3);
    const first = rows[1] as HTMLElement;
    // every line's title is listed, one per row
    expect(within(first).getAllByText('The First Book').length).toBeGreaterThan(0);
    expect(within(first).getAllByText('The Second Book').length).toBeGreaterThan(0);
    expect(within(first).getByText('Paid')).toBeInTheDocument();
    expect(within(first).getByText('Partially refunded')).toBeInTheDocument();
    expect(within(first).getByText(formatMoney(1_299, 'en'))).toBeInTheDocument();
    expect(within(first).getByText(formatMoney(2_450, 'en'))).toBeInTheDocument();
    expect(within(first).getByText(formatMoney(841, 'en'))).toBeInTheDocument();
    expect(
      within(first).getByRole('button', { name: `View order ${TX1.slice(0, 8)}` }),
    ).toHaveTextContent(TX1.slice(0, 8));
  });

  it('names every per-line item after its book, for a three-line order', async () => {
    const third = { ...doneLine, itemId: 'item-9', book: { id: BOOK_B, title: 'Third Title' } };
    ordersData = [
      { transactionId: TX1, paidAt: doneLine.paidAt, lines: [doneLine, refundedLine, third] },
    ];
    renderAt(<SalesOrdersPage />);
    const row = await rowOf('Sales & Orders', 'Third Title');
    const cells = within(row).getAllByRole('cell') as HTMLElement[];
    // columns: date, ref, books, status, gross, earnings
    const [, , books, status, gross, earnings] = cells as HTMLElement[];
    expect(within(books as HTMLElement).getAllByText(/Title|Book/)).toHaveLength(3);
    for (const cell of [status, gross, earnings]) {
      const items = (cell as HTMLElement).querySelectorAll('.ui-sr-only');
      expect([...items].map((i) => i.textContent)).toEqual([
        'The First Book: ',
        'The Second Book: ',
        'Third Title: ',
      ]);
    }
    expect(gross as HTMLElement).toHaveTextContent(formatMoney(2_450, 'en'));
  });

  it('shows the translated "Fee pending" label for a pending split line', async () => {
    renderAt(<SalesOrdersPage />);
    expect(await screen.findByText('Fee pending')).toBeInTheDocument();
    await i18n.changeLanguage('sq');
    expect(await screen.findByText('Tarifa në pritje')).toBeInTheDocument();
  });

  it('sends the search text and the book, country and status filters to the server', async () => {
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    await screen.findByText('Pending Book');
    await user.type(screen.getByRole('searchbox'), '  Novel ');
    await waitFor(() => expect(lastParams('/reports/orders').get('q')).toBe('Novel'));
    await user.selectOptions(await screen.findByLabelText('Book'), BOOK_B);
    await waitFor(() => expect(lastParams('/reports/orders').get('bookId')).toBe(BOOK_B));
    await user.selectOptions(screen.getByLabelText('Country'), 'AL');
    await waitFor(() => expect(lastParams('/reports/orders').get('country')).toBe('AL'));
    await user.selectOptions(screen.getByLabelText('Status'), 'refunded');
    await waitFor(() => expect(lastParams('/reports/orders').get('status')).toBe('refunded'));
    const p = lastParams('/reports/orders');
    expect(p.get('q')).toBe('Novel');
    expect(p.get('from')).toBe('2026-11-01');
    expect(p.get('to')).toBe('2026-12-01');
  });

  it('reads filters from the URL and ignores values the API would reject', async () => {
    renderAt(
      <SalesOrdersPage />,
      `/x?${RANGE}&book=not-a-uuid&status=bogus&country=zzz&page=-4&q=${'x'.repeat(150)}`,
    );
    await screen.findByText('Pending Book');
    const p = lastParams('/reports/orders');
    expect(p.has('bookId')).toBe(false);
    expect(p.has('status')).toBe(false);
    expect(p.has('country')).toBe(false);
    expect(p.get('page')).toBe('1');
    expect(p.get('q')).toBe('x'.repeat(100));
  });

  it('opens a panel with every line of the order, values exactly as the API sent them', async () => {
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    const row = await rowOf('Sales & Orders', 'The First Book');
    await user.click(row);
    const panel = await screen.findByRole('dialog');
    const first = within(panel).getByRole('region', { name: 'The First Book' });
    const second = within(panel).getByRole('region', { name: 'The Second Book' });
    const dd = (scopeEl: HTMLElement, label: string) =>
      within(scopeEl).getByText(label).closest('div')?.querySelector('dd')?.textContent;

    expect(dd(first, 'Price')).toBe(formatMoney(1_299, 'en'));
    expect(dd(first, 'VAT')).toBe(formatMoney(217, 'en'));
    expect(dd(first, 'Payment fee')).toBe(formatMoney(41, 'en'));
    expect(dd(first, 'Commission %')).toBe(formatPercentBps(2_000, 'en'));
    expect(dd(first, 'Commission at sale')).toBe(formatMoney(200, 'en'));
    expect(dd(first, 'Earnings at sale')).toBe(formatMoney(841, 'en'));
    expect(dd(first, 'Refunded')).toBe(formatMoney(0, 'en'));
    expect(dd(first, 'Refunded at')).toBe('—');
    expect(dd(first, 'Paid at')).toBe(formatDateTime(doneLine.paidAt, 'en'));

    expect(dd(second, 'Price')).toBe(formatMoney(2_450, 'en'));
    expect(dd(second, 'VAT')).toBe(formatMoney(408, 'en'));
    expect(dd(second, 'Payment fee')).toBe(formatMoney(73, 'en'));
    expect(dd(second, 'Commission %')).toBe(formatPercentBps(1_500, 'en'));
    expect(dd(second, 'Commission at sale')).toBe(formatMoney(307, 'en'));
    expect(dd(second, 'Commission reversed on refunds')).toBe(formatMoney(184, 'en'));
    expect(dd(second, 'Earnings at sale')).toBe(formatMoney(1_662, 'en'));
    expect(dd(second, 'Refund reversals')).toBe(formatMoney(885, 'en'));
    expect(dd(second, 'Earnings')).toBe(formatMoney(777, 'en'));
    expect(dd(second, 'Refunded')).toBe(formatMoney(1_001, 'en'));
    expect(dd(second, 'Refunded at')).toBe(formatDateTime('2026-11-03T12:30:00Z', 'en'));
    expect(within(second).getByText('Partially refunded')).toBeInTheDocument();
  });

  it('shows "Fee pending" instead of invented split figures in the panel', async () => {
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    const row = await rowOf('Sales & Orders', 'Pending Book');
    await user.click(row);
    const panel = await screen.findByRole('dialog');
    const line = within(panel).getByRole('region', { name: 'Pending Book' });
    expect(within(line).getByText('Fee pending')).toBeInTheDocument();
    const dd = (label: string) =>
      within(line).getByText(label).closest('div')?.querySelector('dd')?.textContent;
    expect(dd('Commission at sale')).toBe('—');
    expect(dd('Earnings at sale')).toBe('—');
    expect(dd('Earnings')).toBe('—');
  });

  it('is operable by keyboard: Tab reaches the button, Enter opens, Esc closes and focus returns', async () => {
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    const row = await rowOf('Sales & Orders', 'The First Book');
    const button = within(row).getByRole('button', { name: /View order/ });
    // The row itself is not a tab stop.
    expect(row).not.toHaveAttribute('tabindex');
    for (let i = 0; i < 40 && document.activeElement !== button; i++) await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('dialog');
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    await user.tab();
    await user.tab();
    await user.tab();
    expect(panel.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('builds the CSV request from the current search, filters, range, language and publisher', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'pub-1' };
    await i18n.changeLanguage('sq');
    const createObjectURL = vi.fn(() => 'blob:csv');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />, `/x?${RANGE}&q=novel&status=paid`);
    await screen.findByText('Pending Book');
    await user.click(screen.getByRole('button', { name: 'Eksporto CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/sales.csv'));
    const p = new URL(String(call?.[0]), 'http://x').searchParams;
    expect(p.get('q')).toBe('novel');
    expect(p.get('status')).toBe('paid');
    expect(p.get('from')).toBe('2026-11-01');
    expect(p.get('to')).toBe('2026-12-01');
    expect(p.get('lang')).toBe('sq');
    expect(p.get('publisherId')).toBe('pub-1');
    expect(call?.[1]?.credentials).toBe('include');
    expect(new Headers(call?.[1]?.headers).get('X-Libraria-Portal')).toBe('1');
    click.mockRestore();
  });

  it('explains an export that is too large, in the current language', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/sales.csv')
        ? json(422, { error: { code: 'EXPORT_TOO_LARGE', message: 'raw english', requestId: 'r' } })
        : route(String(url)),
    );
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    await screen.findByText('Pending Book');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'Too many rows to export. Choose a shorter period or add filters.',
    );
    expect(alert).not.toHaveTextContent('raw english');
  });

  it('asks an admin to pick a publisher first and sends no report request', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: undefined };
    renderAt(<SalesOrdersPage />);
    expect(screen.getByText('Choose a publisher in the sidebar to see its data.')).toBeVisible();
    expect(sent('/reports/')).toHaveLength(0);
  });

  it('clears the filters when an admin switches publisher, with no request mixing them', async () => {
    const user = userEvent.setup();
    renderAt(<Switcher />, `/x?${RANGE}&book=${BOOK_B}&status=paid&q=novel&page=2`);
    await screen.findByText('Pending Book');
    expect(lastParams('/reports/orders').get('bookId')).toBe(BOOK_B);
    fetchMock.mockClear();
    await user.selectOptions(screen.getByLabelText('Publisher'), 'pub-2');
    await waitFor(() =>
      expect(sent('/reports/orders').some((u) => u.includes('publisherId=pub-2'))).toBe(true),
    );
    const forPub2 = sent('/reports/').filter((u) => u.includes('publisherId=pub-2'));
    expect(forPub2.some((u) => /bookId=|status=|[?&]q=/.test(u))).toBe(false);
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByLabelText('Status')).toHaveValue('');
    // the range stays
    expect(lastParams('/reports/orders').get('from')).toBe('2026-11-01');
  });

  it('keeps the params of a deep link opened after the admin picked a publisher elsewhere', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'pub-2' };
    renderAt(<SalesOrdersPage />, `/x?${RANGE}&book=${BOOK_B}&status=refunded`);
    await screen.findByText('Pending Book');
    const p = lastParams('/reports/orders');
    expect(p.get('bookId')).toBe(BOOK_B);
    expect(p.get('status')).toBe('refunded');
    expect(p.get('publisherId')).toBe('pub-2');
  });

  it('drops range-bound filters when the range changes, so no request mixes old and new', async () => {
    const user = userEvent.setup();
    renderAt(
      <>
        <ChangeRange />
        <SalesOrdersPage />
      </>,
      `/x?${RANGE}&book=${BOOK_B}`,
    );
    await screen.findByText('Pending Book');
    expect(lastParams('/reports/orders').get('bookId')).toBe(BOOK_B);
    fetchMock.mockClear();
    await user.click(screen.getByRole('button', { name: 'change range' }));
    await waitFor(() =>
      expect(sent('/reports/orders').some((u) => u.includes('from=2026-05-01'))).toBe(true),
    );
    expect(sent('/reports/orders').every((u) => !u.includes('bookId='))).toBe(true);
  });

  it('follows the URL on Back: the search box matches the URL again', async () => {
    const user = userEvent.setup();
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={newClient()}>
          <MemoryRouter
            initialEntries={[`/x?${RANGE}&q=one`, `/x?${RANGE}&q=two`]}
            initialIndex={1}
          >
            <Back />
            <SalesOrdersPage />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await screen.findByText('Pending Book');
    expect(screen.getByRole('searchbox')).toHaveValue('two');
    await user.type(screen.getByRole('searchbox'), 'x');
    await waitFor(() => expect(lastParams('/reports/orders').get('q')).toBe('twox'));
    await user.click(screen.getByRole('button', { name: 'go back' }));
    await waitFor(() => expect(screen.getByRole('searchbox')).toHaveValue('one'));
    await waitFor(() => expect(lastParams('/reports/orders').get('q')).toBe('one'));
  });

  it('sends page and limit for Orders', async () => {
    ordersPagination = { page: 1, limit: 25, total: 60, totalPages: 3 };
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    await screen.findByText('Pending Book');
    expect(lastParams('/reports/orders').get('page')).toBe('1');
    expect(lastParams('/reports/orders').get('limit')).toBe('25');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastParams('/reports/orders').get('page')).toBe('2'));
  });

  it('offers the last page when the URL page is past the end of the orders', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/reports/orders') && url.includes('page=9')
        ? json(200, { orders: [], pagination: { page: 9, limit: 25, total: 60, totalPages: 3 } })
        : route(String(url)),
    );
    renderAt(<SalesOrdersPage />, `/x?${RANGE}&page=9`);
    expect(await screen.findByRole('button', { name: 'Go to the last page' })).toBeInTheDocument();
  });

  it('shows the commission rate of a pending line, but no placeholder amounts', async () => {
    const withRate = { ...pendingLine, commissionRateBps: 2_000 };
    ordersData = [{ transactionId: TX2, paidAt: withRate.paidAt, lines: [withRate] }];
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    await user.click(await rowOf('Sales & Orders', 'Pending Book'));
    const line = within(await screen.findByRole('dialog')).getByRole('region', {
      name: 'Pending Book',
    });
    const dd = (label: string) =>
      within(line).getByText(label).closest('div')?.querySelector('dd')?.textContent;
    expect(dd('Commission %')).toBe(formatPercentBps(2_000, 'en'));
    expect(dd('Commission at sale')).toBe('—');
  });

  it('labels an unknown book id, uppercases the country and shortens a long search', async () => {
    const stranger = '33333333-3333-4333-8333-333333333333';
    renderAt(<SalesOrdersPage />, `/x?${RANGE}&book=${stranger}&country=al&q=${'y'.repeat(150)}`);
    await screen.findByText('Pending Book');
    expect(lastParams('/reports/orders').get('country')).toBe('AL');
    expect(screen.getByRole('option', { name: 'Unknown book' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('y'.repeat(100));
  });

  it('exports what is in the search box even before the pause has applied it', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() }),
    );
    const user = userEvent.setup();
    renderAt(<SalesOrdersPage />);
    await screen.findByText('Pending Book');
    await user.type(screen.getByRole('searchbox'), 'quick');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/sales.csv'));
    expect(String(call?.[0])).toContain('q=quick');
    click.mockRestore();
  });

  it('says what the export contains', async () => {
    renderAt(<SalesOrdersPage />);
    expect(await screen.findByText('The export lists the matching sale lines.')).toBeVisible();
  });

  it('closes the panel when the range changes', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderAt(
      <>
        <ChangeRange />
        <SalesOrdersPage />
      </>,
    );
    await user.click(await rowOf('Sales & Orders', 'The First Book'));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'change range', hidden: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the empty state when nothing matches', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/reports/orders')
        ? json(200, { orders: [], pagination: { page: 1, limit: 25, total: 0, totalPages: 0 } })
        : route(String(url)),
    );
    renderAt(<SalesOrdersPage />, `/x?${RANGE}&status=refunded`);
    expect(await screen.findByText('No sales match these filters.')).toBeInTheDocument();
  });

  it('has no accessibility violations, with and without the panel open', async () => {
    const user = userEvent.setup();
    const { container } = renderAt(<SalesOrdersPage />);
    await screen.findByText('Pending Book');
    expect(await axe(container)).toHaveNoViolations();
    await user.click(await rowOf('Sales & Orders', 'The First Book'));
    const panel = await screen.findByRole('dialog');
    expect(await axe(panel)).toHaveNoViolations();
  });
});

describe.each(['en', 'sq'])('whole-page accessibility with the panel open (%s)', (lang) => {
  it.each([
    ['orders', <SalesOrdersPage key="o" />, 'Sales & Orders', 'Shitjet dhe porositë'],
    ['transactions', <TransactionsPage key="t" />, 'Transactions', 'Transaksionet'],
  ] as const)('%s page has no violations', async (_n, pageEl, nameEn, nameSq) => {
    await i18n.changeLanguage(lang);
    const user = userEvent.setup();
    renderAt(pageEl);
    const table = await screen.findByRole('region', { name: lang === 'en' ? nameEn : nameSq });
    await user.click(within(table).getAllByRole('button')[0] as HTMLElement);
    await screen.findByRole('dialog');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});

describe('TransactionsPage', () => {
  it('opens a sale from its button, by keyboard, and returns focus there', async () => {
    const user = userEvent.setup();
    renderAt(<TransactionsPage />);
    const row = await rowOf('Transactions', 'The Second Book');
    const button = within(row).getByRole('button', { name: /View sale/ });
    expect(row).not.toHaveAttribute('tabindex');
    for (let i = 0; i < 40 && document.activeElement !== button; i++) await user.tab();
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('lists every line with VAT, fee, commission %, commission, earnings and refunded', async () => {
    renderAt(<TransactionsPage />);
    const row = await rowOf('Transactions', 'The Second Book');
    for (const header of [
      'Price',
      'VAT',
      'Fee',
      'Commission %',
      'Commission',
      'Earnings',
      'Refunded',
    ]) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(within(row).getByText(formatPercentBps(1_500, 'en'))).toBeInTheDocument();
    expect(within(row).getByText(formatMoney(123, 'en'))).toBeInTheDocument();
    expect(within(row).getByText(formatMoney(1_001, 'en'))).toBeInTheDocument();
    expect(screen.getByText('Fee pending')).toBeInTheDocument();
  });

  it('sends page and limit, and the filters, to the server', async () => {
    salesPagination = { page: 1, limit: 25, total: 60, totalPages: 3 };
    const user = userEvent.setup();
    renderAt(<TransactionsPage />, `/x?${RANGE}&status=paid`);
    await screen.findByText('The Second Book');
    expect(lastParams('/reports/sales').get('page')).toBe('1');
    expect(lastParams('/reports/sales').get('limit')).toBe('25');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastParams('/reports/sales').get('page')).toBe('2'));
    expect(lastParams('/reports/sales').get('status')).toBe('paid');
    expect(lastParams('/reports/sales').get('limit')).toBe('25');
  });

  it('offers the last page when the URL page is past the end', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/reports/sales?') && url.includes('page=9')
        ? json(200, {
            lines: [],
            pagination: { page: 9, limit: 25, total: 60, totalPages: 3 },
          })
        : route(String(url)),
    );
    renderAt(<TransactionsPage />, `/x?${RANGE}&page=9`);
    expect(await screen.findByRole('button', { name: 'Go to the last page' })).toBeInTheDocument();
  });

  it('opens the breakdown of one line, and exports CSV with the same filters', async () => {
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:csv'), revokeObjectURL: vi.fn() }),
    );
    const user = userEvent.setup();
    renderAt(<TransactionsPage />, `/x?${RANGE}&q=second`);
    const row = await rowOf('Transactions', 'The Second Book');
    await user.click(row);
    const panel = await screen.findByRole('dialog');
    expect(within(panel).queryByText('The First Book')).not.toBeInTheDocument();
    expect(within(panel).getByText(formatMoney(2_450, 'en'))).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/sales.csv'));
    expect(String(call?.[0])).toContain('q=second');
    click.mockRestore();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAt(<TransactionsPage />);
    await screen.findByText('The Second Book');
    expect(await axe(container)).toHaveNoViolations();
  });
});
