import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { BookPage, type BookPageData } from '../book/BookPage';
import { createI18n, type Lang } from '../i18n';
import type { BookDetail, Receipt } from '../lib/types';
import { action as bookAction } from '../routes/book';
import { default as CheckoutStart, loader as checkoutStartLoader } from '../routes/checkout-start';
import {
  action as statusPageAction,
  default as CheckoutStatus,
  loader as statusPageLoader,
} from '../routes/checkout-status';
import {
  shouldRevalidate as statusShouldRevalidate,
  loader as statusLoader,
} from '../routes/transaction-status';
import { env } from '../server/env.server';
import { commitSession, getSession, type SessionData } from '../server/session.server';
import { POLL_AT_MS } from './ConfirmPayment';

// jsdom cannot compute colours; contrast is checked in the design package.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const ORIGIN = 'http://localhost:5174';
const ID = '15459259-2a29-5a98-87aa-5f467426529a';
const OTHER = '5a6f1c1e-0d3b-4f7e-9a51-3f0e2b7c9d10';
const PUB = '3179c2d0-524d-5ac4-b884-025de7590087';
const TXN = '0b6f3f5e-8a7c-4d2b-9e1f-6c5d4b3a2f10';
const PATH = `/libri/${ID}/zonja-e-hanit-te-bardhe`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const apiError = (status: number, code: string) =>
  json({ error: { code, message: 'x', requestId: 'r' } }, status);

type Handler = (init: RequestInit | undefined, url: URL) => Response;

/** A fetch mock keyed by "METHOD /path"; an unexpected call fails the test loudly. */
function api(routes: Record<string, Handler>) {
  const mock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? 'GET'} ${url.pathname.replace('/api/v1', '')}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected API call ${key}`);
    return handler(init, url);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const bodyOf = (init: RequestInit | undefined) => JSON.parse(String(init?.body));

function receipt(status: string, overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: TXN,
    status,
    provider: 'simulated',
    total: { amountCents: 599, currency: 'EUR' },
    checkoutUrl: null,
    createdAt: '2026-11-16T10:00:00.000Z',
    paidAt: status === 'paid' ? '2026-11-16T10:01:00.000Z' : null,
    items: [
      {
        book: {
          id: ID,
          title: 'Zonja e Hanit të Bardhë',
          author: 'Leart Osmani',
          coverImageUrl: `/api/v1/books/${ID}/cover?v=1`,
          publisher: { id: PUB, name: 'Pema e Kuqe Botime' },
        },
        unitPriceCents: 599,
        refundedCents: 0,
        refunded: false,
      },
    ],
    ...overrides,
  };
}

const READER: SessionData = {
  token: 'reader-token',
  user: { id: 'u1', email: 'leart@example.com', displayName: 'Leart' },
};

async function cookieWith(data: SessionData): Promise<string> {
  const session = await getSession(new Request(ORIGIN));
  for (const [key, value] of Object.entries(data)) {
    session.set(key as keyof SessionData, value as never);
  }
  return (await commitSession(session)).split(';')[0] as string;
}

async function sessionOf(res: Response) {
  const cookie = (res.headers.get('Set-Cookie') ?? '').split(';')[0] as string;
  return getSession(new Request(ORIGIN, { headers: { Cookie: cookie } }));
}

function post(path: string, fields: Record<string, string>, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: ORIGIN,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: new URLSearchParams(fields),
  });
}

function get(path: string, cookie?: string): Request {
  return new Request(`${ORIGIN}${path}`, cookie ? { headers: { Cookie: cookie } } : undefined);
}

// biome-ignore lint/suspicious/noExplicitAny: route functions only read request and params
const args = (request: Request, params: Record<string, string>): any => ({
  request,
  params,
  context: {},
});

const buyArgs = (request: Request) => args(request, { id: ID, slug: 'zonja-e-hanit-te-bardhe' });

/** A loader or action outcome: the Response it returned or threw, or its plain data. */
async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (thrown) {
    return thrown;
  }
}

/** React Router's `data()` result: the value and its init. */
type DataResult<T> = { data: T; init?: { headers?: HeadersInit; status?: number } | null };

const setCookieOf = (result: DataResult<unknown>) =>
  new Headers(result.init?.headers ?? undefined).get('Set-Cookie');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  env.PAYMENTS_MODE = 'simulated';
  env.PADDLE_CLIENT_TOKEN = undefined;
});

describe('buy action', () => {
  it('buy reuses the stored idempotency key while the transaction is pending', async () => {
    const cookie = await cookieWith({
      ...READER,
      checkouts: { [ID]: { transactionId: TXN, idempotencyKey: 'stored-key-1' } },
    });
    const fetchMock = api({
      [`GET /transactions/${TXN}`]: () => json({ transaction: receipt('pending') }),
      'POST /checkout-sessions': () =>
        json({ transaction: receipt('pending'), checkout: { provider: 'simulated', url: null } }),
    });

    const res = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH }, cookie)),
    )) as Response;

    const checkoutCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(bodyOf(checkoutCall?.[1])).toEqual({ bookIds: [ID], idempotencyKey: 'stored-key-1' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/pagesa/${TXN}`);
    expect((await sessionOf(res)).get('checkouts')).toEqual({
      [ID]: { transactionId: TXN, idempotencyKey: 'stored-key-1' },
    });
  });

  it('starts a new idempotency key once the stored transaction has ended', async () => {
    const cookie = await cookieWith({
      ...READER,
      checkouts: { [ID]: { transactionId: TXN, idempotencyKey: 'stored-key-1' } },
    });
    const NEW = '7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6';
    const fetchMock = api({
      [`GET /transactions/${TXN}`]: () => json({ transaction: receipt('cancelled') }),
      'POST /checkout-sessions': () =>
        json(
          {
            transaction: receipt('pending', { id: NEW }),
            checkout: { provider: 'simulated', url: null },
          },
          201,
        ),
    });

    const res = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH }, cookie)),
    )) as Response;

    const checkoutCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const { idempotencyKey } = bodyOf(checkoutCall?.[1]);
    expect(idempotencyKey).not.toBe('stored-key-1');
    expect(idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers.get('Location')).toBe(`/pagesa/${NEW}`);
    expect((await sessionOf(res)).get('checkouts')).toEqual({
      [ID]: { transactionId: NEW, idempotencyKey },
    });
  });

  it('buy redirects a guest to /hyr with returnTo', async () => {
    const fetchMock = api({});

    const fromDiscover = (await settle(
      bookAction(buyArgs(post(PATH, { intent: 'buy', returnTo: '/' }))),
    )) as Response;
    expect(fromDiscover.status).toBe(302);
    expect(fromDiscover.headers.get('Location')).toBe('/hyr?returnTo=%2F');

    const unsafe = (await settle(
      bookAction(buyArgs(post(PATH, { intent: 'buy', returnTo: '//evil.example' }))),
    )) as Response;
    expect(unsafe.headers.get('Location')).toBe(`/hyr?returnTo=${encodeURIComponent(PATH)}`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin post before anything else', async () => {
    const fetchMock = api({});
    const request = new Request(`${ORIGIN}${PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://evil.example',
      },
      body: new URLSearchParams({ intent: 'buy' }),
    });
    const res = (await settle(bookAction(buyArgs(request)))) as Response;
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('buy redirects to /pagesa/:id when checkout.url is null', async () => {
    const cookie = await cookieWith(READER);
    const fetchMock = api({
      'POST /checkout-sessions': () =>
        json(
          { transaction: receipt('pending'), checkout: { provider: 'simulated', url: null } },
          201,
        ),
    });

    const res = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH }, cookie)),
    )) as Response;

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(`/pagesa/${TXN}`);
    const { idempotencyKey } = bodyOf(fetchMock.mock.calls[0]?.[1]);
    expect((await sessionOf(res)).get('checkouts')).toEqual({
      [ID]: { transactionId: TXN, idempotencyKey },
    });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer reader-token');
  });

  it('redirects to the provider when checkout.url is set', async () => {
    const cookie = await cookieWith(READER);
    const url = 'https://pay.example.com/pagesa?_ptxn=txn_01paddle';
    api({
      'POST /checkout-sessions': () =>
        json({ transaction: receipt('pending'), checkout: { provider: 'paddle', url } }, 201),
    });
    const res = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH }, cookie)),
    )) as Response;
    expect(res.headers.get('Location')).toBe(url);
  });

  it('buy shows the unavailable message on PAYMENTS_UNAVAILABLE', async () => {
    const cookie = await cookieWith(READER);
    api({ 'POST /checkout-sessions': () => apiError(503, 'PAYMENTS_UNAVAILABLE') });

    const result = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH }, cookie)),
    )) as DataResult<{ purchaseError: string }>;
    expect(result.data).toEqual({ purchaseError: 'unavailable' });
    expect(setCookieOf(result)).toBeTruthy();

    // And the purchase box shows it.
    const book = bookDetail();
    const data: BookPageData = {
      lang: 'sq',
      book,
      viewer: {
        owned: false,
        acquiredAt: null,
        progress: null,
        refund: null,
        pendingTransactionId: null,
      },
      path: PATH,
      origin: ORIGIN,
      shelves: { publisher: [], similar: [], author: [] },
    };
    const Stub = createRoutesStub([
      {
        path: '/libri/:id/:slug?',
        loader: () => data,
        action: () => ({ purchaseError: 'unavailable' }),
        Component: BookPage,
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={[PATH]} />
      </I18nextProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Bli librin' }));
    expect(await screen.findByText('Blerjet nuk janë ende të disponueshme')).toBeInTheDocument();
  });

  it.each([
    ['BOOK_NOT_FOR_SALE', 409],
    ['NOT_FOUND', 404],
  ])('%s returns a form error for the purchase box', async (code, status) => {
    const cookie = await cookieWith(READER);
    api({ 'POST /checkout-sessions': () => apiError(status, code) });
    const result = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH }, cookie)),
    )) as DataResult<{ purchaseError: string }>;
    expect(result.data).toEqual({ purchaseError: 'notForSale' });
  });

  it('ALREADY_OWNED redirects to the book', async () => {
    const cookie = await cookieWith(READER);
    api({ 'POST /checkout-sessions': () => apiError(409, 'ALREADY_OWNED') });
    const res = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: '/' }, cookie)),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(PATH);
  });

  it('two posts of one page with an empty session send the same form key', async () => {
    const cookie = await cookieWith(READER);
    const FORM_KEY = '3f9a1c2e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
    const fetchMock = api({
      'POST /checkout-sessions': () =>
        json({ transaction: receipt('pending'), checkout: { provider: 'simulated', url: null } }),
    });
    const fields = { intent: 'buy', returnTo: PATH, idempotencyKey: FORM_KEY };

    // A double click before hydration, or two tabs: concurrent posts, no stored checkout yet.
    const [a, b] = (await Promise.all([
      bookAction(buyArgs(post(PATH, fields, cookie))),
      bookAction(buyArgs(post(PATH, fields, cookie))),
    ])) as Response[];

    const keys = fetchMock.mock.calls.map(([, init]) => bodyOf(init).idempotencyKey);
    expect(keys).toEqual([FORM_KEY, FORM_KEY]);
    expect(a?.headers.get('Location')).toBe(`/pagesa/${TXN}`);
    expect(b?.headers.get('Location')).toBe(`/pagesa/${TXN}`);
    expect((await sessionOf(a as Response)).get('checkouts')).toEqual({
      [ID]: { transactionId: TXN, idempotencyKey: FORM_KEY },
    });
  });

  it('a stale page whose key belongs to an ended checkout gets a fresh one, once', async () => {
    const cookie = await cookieWith(READER);
    const STALE = 'aaaaaaaa-1111-4222-8333-444444444444';
    const NEW = '7d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6';
    const fetchMock = api({
      'POST /checkout-sessions': (init) =>
        bodyOf(init).idempotencyKey === STALE
          ? json({
              transaction: receipt('cancelled'),
              checkout: { provider: 'simulated', url: null },
            })
          : json(
              {
                transaction: receipt('pending', { id: NEW }),
                checkout: { provider: 'simulated', url: null },
              },
              201,
            ),
    });

    const res = (await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH, idempotencyKey: STALE }, cookie)),
    )) as Response;

    const keys = fetchMock.mock.calls.map(([, init]) => bodyOf(init).idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(STALE);
    expect(keys[1]).not.toBe(STALE);
    expect(res.headers.get('Location')).toBe(`/pagesa/${NEW}`);
    expect((await sessionOf(res)).get('checkouts')).toEqual({
      [ID]: { transactionId: NEW, idempotencyKey: keys[1] },
    });
  });

  it('the stored pending key wins over the form key', async () => {
    const cookie = await cookieWith({
      ...READER,
      checkouts: { [ID]: { transactionId: TXN, idempotencyKey: 'stored-key-1' } },
    });
    const fetchMock = api({
      [`GET /transactions/${TXN}`]: () => json({ transaction: receipt('pending') }),
      'POST /checkout-sessions': () =>
        json({ transaction: receipt('pending'), checkout: { provider: 'simulated', url: null } }),
    });
    await bookAction(
      buyArgs(post(PATH, { intent: 'buy', returnTo: PATH, idempotencyKey: 'form-key-12' }, cookie)),
    );
    const checkoutCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(bodyOf(checkoutCall?.[1]).idempotencyKey).toBe('stored-key-1');
  });

  it('the purchase box renders the page key into the buy form', async () => {
    const data: BookPageData = {
      lang: 'sq',
      book: bookDetail(),
      viewer: {
        owned: false,
        acquiredAt: null,
        progress: null,
        refund: null,
        pendingTransactionId: null,
      },
      path: PATH,
      origin: ORIGIN,
      checkoutKey: 'page-key-123',
      shelves: { publisher: [], similar: [], author: [] },
    };
    const Stub = createRoutesStub([
      { path: '/libri/:id/:slug?', loader: () => data, Component: BookPage },
    ]);
    const { container } = render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={[PATH]} />
      </I18nextProvider>,
    );
    await screen.findByRole('button', { name: 'Bli librin' });
    expect(container.querySelector('input[name="idempotencyKey"]')).toHaveValue('page-key-123');
  });

  it('a double click on "Bli librin" submits once', async () => {
    const action = vi.fn(() => new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)));
    const data: BookPageData = {
      lang: 'sq',
      book: bookDetail(),
      viewer: {
        owned: false,
        acquiredAt: null,
        progress: null,
        refund: null,
        pendingTransactionId: null,
      },
      path: PATH,
      origin: ORIGIN,
      shelves: { publisher: [], similar: [], author: [] },
    };
    const Stub = createRoutesStub([
      { path: '/libri/:id/:slug?', loader: () => data, action, Component: BookPage },
    ]);
    render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={[PATH]} />
      </I18nextProvider>,
    );
    await userEvent.dblClick(await screen.findByRole('button', { name: 'Bli librin' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(action).toHaveBeenCalledTimes(1);
  });
});

function bookDetail(): BookDetail {
  return {
    id: ID,
    title: 'Zonja e Hanit të Bardhë',
    author: 'Leart Osmani',
    isbn13: null,
    description: null,
    genre: 'Fiction',
    language: 'sq',
    price: { amountCents: 599, currency: 'EUR' },
    coverImageUrl: null,
    publishedAt: null,
    publisher: { id: PUB, name: 'Pema e Kuqe Botime' },
    forSale: true,
    mediaType: 'ebook',
    durationSeconds: null,
    pageCount: null,
    availability: 'on_sale',
  };
}

describe('/pagesa/:transactionId loader and action', () => {
  it('requires sign-in', async () => {
    const res = (await settle(
      statusPageLoader(args(get(`/pagesa/${TXN}`), { transactionId: TXN })),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      `/hyr?returnTo=${encodeURIComponent(`/pagesa/${TXN}`)}`,
    );
  });

  it("404s a transaction that is not the reader's", async () => {
    const cookie = await cookieWith(READER);
    api({ [`GET /transactions/${TXN}`]: () => apiError(404, 'NOT_FOUND') });
    const res = (await settle(
      statusPageLoader(args(get(`/pagesa/${TXN}`, cookie), { transactionId: TXN })),
    )) as Response;
    expect(res.status).toBe(404);

    const malformed = (await settle(
      statusPageLoader(args(get('/pagesa/abc', cookie), { transactionId: 'abc' })),
    )) as Response;
    expect(malformed.status).toBe(404);
  });

  it('simulated panel is absent when PAYMENTS_MODE is paddle', async () => {
    const cookie = await cookieWith(READER);
    api({ [`GET /transactions/${TXN}`]: () => json({ transaction: receipt('pending') }) });

    env.PAYMENTS_MODE = 'paddle';
    const paddle = (await statusPageLoader(
      args(get(`/pagesa/${TXN}`, cookie), { transactionId: TXN }),
    )) as DataResult<{ simulated: boolean }>;
    expect(paddle.data.simulated).toBe(false);
    renderStatus({ loader: () => paddle.data });
    expect(await screen.findByText('Po konfirmojmë pagesën…')).toBeInTheDocument();
    expect(screen.queryByText('Mjedis zhvillimi · pagesë e simuluar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Paguaj' })).not.toBeInTheDocument();

    // The sandbox action refuses too.
    const refused = (await settle(
      statusPageAction(
        args(post(`/pagesa/${TXN}`, { event: 'pay' }, cookie), { transactionId: TXN }),
      ),
    )) as Response;
    expect(refused.status).toBe(404);
  });

  it('shows the simulated panel only while pending in simulated mode', async () => {
    renderStatus({ loader: () => ({ transaction: receipt('pending'), simulated: true }) });
    expect(await screen.findByText('Mjedis zhvillimi · pagesë e simuluar')).toBeInTheDocument();
    for (const name of ['Paguaj', 'Dështo', 'Anulo']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('the simulated panel posts the sandbox event and comes back to the page', async () => {
    const cookie = await cookieWith(READER);
    const fetchMock = api({
      [`POST /sandbox/transactions/${TXN}/events`]: () =>
        json({ result: {}, transaction: receipt('paid') }),
    });
    for (const [event, kind] of [
      ['pay', 'payment_succeeded'],
      ['fail', 'payment_failed'],
      ['cancel', 'checkout_cancelled'],
    ] as const) {
      fetchMock.mockClear();
      const res = (await statusPageAction(
        args(post(`/pagesa/${TXN}`, { event }, cookie), { transactionId: TXN }),
      )) as Response;
      expect(bodyOf(fetchMock.mock.calls[0]?.[1])).toEqual({ kind });
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(`/pagesa/${TXN}`);
    }
  });

  it('status page stops polling on paid and clears the stored checkout', async () => {
    // The loader clears the stored checkout for a finished transaction.
    const cookie = await cookieWith({
      ...READER,
      checkouts: {
        [ID]: { transactionId: TXN, idempotencyKey: 'k1' },
        [OTHER]: { transactionId: 'another', idempotencyKey: 'k2' },
      },
    });
    api({ [`GET /transactions/${TXN}`]: () => json({ transaction: receipt('paid') }) });
    const loaded = (await statusPageLoader(
      args(get(`/pagesa/${TXN}`, cookie), { transactionId: TXN }),
    )) as DataResult<unknown>;
    const session = await sessionOf(
      new Response(null, { headers: { 'Set-Cookie': setCookieOf(loaded) ?? '' } }),
    );
    expect(session.get('checkouts')).toEqual({
      [OTHER]: { transactionId: 'another', idempotencyKey: 'k2' },
    });
    expect(session.get('token')).toBe('reader-token');

    // The page polls while pending and stops once the status leaves pending.
    vi.useFakeTimers();
    let status = 'pending';
    const poll = vi.fn(() => ({ status }));
    const page = vi.fn(() => ({ transaction: receipt(status), simulated: false }));
    renderStatus({ loader: page, statusLoader: poll });
    await flush(0);
    expect(screen.getByText('Po konfirmojmë pagesën…')).toBeInTheDocument();

    await flush(POLL_AT_MS[0] as number);
    expect(poll).toHaveBeenCalledTimes(1);

    status = 'paid';
    await flush((POLL_AT_MS[1] as number) - (POLL_AT_MS[0] as number));
    expect(poll).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole('heading', { name: 'Libri është në bibliotekën tënde' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shko te libri' })).toHaveAttribute('href', PATH);
    expect(screen.getByRole('img', { name: /Zonja e Hanit të Bardhë/ })).toBeInTheDocument();

    await flush(120_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('status page shows the still-processing message after 60 seconds', async () => {
    vi.useFakeTimers();
    const poll = vi.fn(() => ({ status: 'pending' }));
    renderStatus({
      loader: () => ({ transaction: receipt('pending'), simulated: false }),
      statusLoader: poll,
    });
    await flush(0);
    await flush(59_000);
    expect(
      screen.queryByText(
        'Pagesa po përpunohet; do ta shohësh librin në bibliotekë sapo të konfirmohet.',
      ),
    ).not.toBeInTheDocument();

    await flush(1_000);
    expect(
      screen.getByText(
        'Pagesa po përpunohet; do ta shohësh librin në bibliotekë sapo të konfirmohet.',
      ),
    ).toBeInTheDocument();
    expect(poll).toHaveBeenCalledTimes(POLL_AT_MS.length);
    expect(POLL_AT_MS.slice(0, 5)).toEqual([1_000, 2_000, 3_000, 5_000, 10_000]);
    expect(POLL_AT_MS.at(-1)).toBe(60_000);

    await flush(60_000);
    expect(poll).toHaveBeenCalledTimes(POLL_AT_MS.length);
  });

  it.each([
    ['failed', 'Pagesa nuk u krye'],
    ['cancelled', 'Pagesa u anulua'],
    ['expired', 'Pagesa skadoi'],
  ])('%s explains itself and offers "Provo përsëri"', async (status, heading) => {
    const { container } = renderStatus({
      loader: () => ({ transaction: receipt(status), simulated: true }),
    });
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Provo përsëri' })).toHaveAttribute('href', PATH);
    expect(screen.queryByText('Mjedis zhvillimi · pagesë e simuluar')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('a pending Paddle transaction offers "Vazhdo pagesën" to its checkout', async () => {
    const url = 'http://localhost:5174/pagesa?_ptxn=txn_01paddle';
    renderStatus({
      loader: () => ({
        transaction: receipt('pending', { provider: 'paddle', checkoutUrl: url }),
        simulated: false,
      }),
    });
    expect(await screen.findByRole('link', { name: 'Vazhdo pagesën' })).toHaveAttribute(
      'href',
      url,
    );
  });

  it('no "Vazhdo pagesën" for the simulated provider or without a checkout URL', async () => {
    renderStatus({
      loader: () => ({
        transaction: receipt('pending', { provider: 'paddle', checkoutUrl: null }),
        simulated: false,
      }),
    });
    expect(await screen.findByText('Po konfirmojmë pagesën…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vazhdo pagesën' })).not.toBeInTheDocument();
  });

  it('the pending page passes axe, in English too', async () => {
    const { container } = renderStatus(
      { loader: () => ({ transaction: receipt('pending'), simulated: true }) },
      'en',
    );
    expect(await screen.findByText('Confirming your payment…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('/pagesa/:transactionId/status', () => {
  it('returns only the status, never cached', async () => {
    const cookie = await cookieWith(READER);
    api({ [`GET /transactions/${TXN}`]: () => json({ transaction: receipt('paid') }) });
    const res = (await statusLoader(
      args(get(`/pagesa/${TXN}/status`, cookie), { transactionId: TXN }),
    )) as Response;
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ status: 'paid' });
  });

  it('sends a signed-out reader to sign-in, back to the page rather than this JSON', async () => {
    const res = (await settle(
      statusLoader(args(get(`/pagesa/${TXN}/status`), { transactionId: TXN })),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      `/hyr?returnTo=${encodeURIComponent(`/pagesa/${TXN}`)}`,
    );
  });

  it('404s an unknown, foreign or malformed id', async () => {
    const cookie = await cookieWith(READER);
    api({ [`GET /transactions/${TXN}`]: () => apiError(404, 'NOT_FOUND') });
    const foreign = (await statusLoader(
      args(get(`/pagesa/${TXN}/status`, cookie), { transactionId: TXN }),
    )) as Response;
    expect(foreign.status).toBe(404);
    expect(foreign.headers.get('Cache-Control')).toBe('private, no-store');
    const malformed = (await statusLoader(
      args(get('/pagesa/abc/status', cookie), { transactionId: 'abc' }),
    )) as Response;
    expect(malformed.status).toBe(404);
  });

  it('answers "could not tell" when the API fails, so the page keeps polling', async () => {
    const cookie = await cookieWith(READER);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api({ [`GET /transactions/${TXN}`]: () => apiError(500, 'INTERNAL') });
    const res = (await statusLoader(
      args(get(`/pagesa/${TXN}/status`, cookie), { transactionId: TXN }),
    )) as Response;
    expect(await res.json()).toEqual({ status: null });
  });
});

describe('/pagesa (Paddle landing)', () => {
  it('shows an error state without a client token', async () => {
    const cookie = await cookieWith(READER);
    const loaded = await checkoutStartLoader(args(get('/pagesa?_ptxn=txn_01', cookie), {}));
    const Stub = createRoutesStub([
      { path: '/pagesa', loader: () => loaded, Component: CheckoutStart },
    ]);
    render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={['/pagesa?_ptxn=txn_01']} />
      </I18nextProvider>,
    );
    expect(await screen.findByText('Pagesa nuk mund të hapet')).toBeInTheDocument();
    expect(screen.getByText('Blerjet nuk janë ende të disponueshme')).toBeInTheDocument();
    expect(document.querySelector('script[src*="paddle"]')).toBeNull();
  });

  it('a completed checkout it cannot match shows the processing message with a way on', async () => {
    let callback: ((event: { name?: string }) => void) | undefined;
    const paddle = {
      Environment: { set: vi.fn() },
      Initialize: vi.fn((options: { eventCallback?: (event: { name?: string }) => void }) => {
        callback = options.eventCallback;
      }),
    };
    vi.stubGlobal('Paddle', paddle);
    const loaded = {
      clientToken: 'test_client_token',
      environment: 'sandbox',
      ptxn: 'txn_01',
      transactionId: null,
      bookId: null,
    };
    const Stub = createRoutesStub([
      { path: '/pagesa', loader: () => loaded, Component: CheckoutStart },
    ]);
    render(
      <I18nextProvider i18n={createI18n('sq')}>
        <Stub initialEntries={['/pagesa?_ptxn=txn_01']} />
      </I18nextProvider>,
    );
    expect(await screen.findByText('Po hapim pagesën…')).toBeInTheDocument();
    const script = document.querySelector<HTMLScriptElement>(
      'script[src="https://cdn.paddle.com/paddle/v2/paddle.js"]',
    );
    expect(script).not.toBeNull();
    act(() => script?.onload?.(new Event('load')));
    expect(paddle.Environment.set).toHaveBeenCalledWith('sandbox');
    expect(paddle.Initialize).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'test_client_token' }),
    );

    act(() => callback?.({ name: 'checkout.completed' }));
    expect(
      screen.getByText(
        'Pagesa po përpunohet; do ta shohësh librin në bibliotekë sapo të konfirmohet.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kthehu te Eksploro' })).toHaveAttribute(
      'href',
      '/eksploro',
    );
  });
});

type StubLoader = () => unknown;

function renderStatus(
  { loader, statusLoader: poll }: { loader: StubLoader; statusLoader?: StubLoader },
  lang: Lang = 'sq',
) {
  const Stub = createRoutesStub([
    {
      path: '/pagesa/:transactionId',
      loader,
      action: () => null,
      Component: CheckoutStatus,
    },
    {
      path: '/pagesa/:transactionId/status',
      loader: poll ?? (() => ({ status: 'pending' })),
      shouldRevalidate: statusShouldRevalidate,
    },
  ]);
  return render(
    <I18nextProvider i18n={createI18n(lang)}>
      <Stub initialEntries={[`/pagesa/${TXN}`]} />
    </I18nextProvider>,
  );
}

/**
 * Advance fake time in small steps, each inside act(), so React commits (and the next poll gets
 * scheduled) between steps, and React Router's promises settle.
 */
async function flush(ms: number) {
  const STEP = 250;
  for (let done = 0; done < ms || done === 0; done += STEP) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(STEP, ms - done));
    });
  }
}
