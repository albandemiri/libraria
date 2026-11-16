import { type APIRequestContext, expect, type Page, test } from '@playwright/test';

/**
 * Buying end to end in simulated mode. Needs the Docker stack up with `seed:demo` loaded and
 * PAYMENTS_MODE=simulated (the local default). Runs in English: headless Chromium here lacks the
 * Albanian ICU data, so Albanian pages would differ between server and browser formatting.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:3000/api/v1';
const BOOK_PATH = /^\/libri\/([0-9a-f-]{36})(\/|$)/;
const CHECKOUT_URL = /\/pagesa\/[0-9a-f-]{36}$/;

type Transaction = { id: string; status: string; items: Array<{ book: { id: string } }> };

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: 'libraria_lang', value: 'en', url: baseURL ?? 'http://localhost:5174' },
  ]);
});

async function register(page: Page, email: string, password: string) {
  await page.goto('/regjistrohu');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
}

/** Opens, from /eksploro, the first book that can be bought and is not in `skip`; returns its id. */
async function openBuyableBook(page: Page, skip: string[] = []): Promise<string> {
  await page.goto('/eksploro');
  const hrefs = await page
    .locator('main a[href^="/libri/"]')
    .evaluateAll((links) => [...new Set(links.map((a) => a.getAttribute('href') ?? ''))]);
  for (const href of hrefs) {
    const id = BOOK_PATH.exec(href)?.[1];
    if (!id || skip.includes(id)) continue;
    if (!page.url().endsWith('/eksploro')) await page.goto('/eksploro');
    await page.locator(`main a[href="${href}"]`).first().click();
    await page.waitForURL((url) => url.pathname.startsWith(`/libri/${id}`));
    // Wait for the book page itself, then see whether its purchase box offers "Buy the book".
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Purchase' })).toBeVisible();
    if (await page.getByRole('button', { name: 'Buy the book' }).isVisible()) return id;
  }
  throw new Error('no buyable book on /eksploro: is the demo data loaded?');
}

/** The reader's transactions, through the API with a token from a separate login. */
async function transactionsFor(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<Transaction[]> {
  const login = await request.post(`${API}/auth/login`, { data: { email, password } });
  expect(login.ok()).toBe(true);
  const { token } = (await login.json()) as { token: string };
  const res = await request.get(`${API}/transactions?limit=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { transactions: Transaction[] }).transactions;
}

test('a reader buys a book in simulated mode, and a cancelled payment can be retried', async ({
  page,
  request,
}) => {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'e2e-password-123';
  await register(page, email, password);

  // A double click opens one checkout, not two.
  const first = await openBuyableBook(page);
  await page.getByRole('button', { name: 'Buy the book' }).dblclick();
  await page.waitForURL(CHECKOUT_URL);
  await expect(page.getByRole('heading', { name: 'Confirming your payment…' })).toBeVisible();
  const transactions = await transactionsFor(request, email, password);
  const forFirst = transactions.filter((t) => t.items.some((item) => item.book.id === first));
  expect(forFirst).toHaveLength(1);
  expect(forFirst[0]?.status).toBe('pending');

  // The simulated provider pays; the signed webhook grants the book.
  await expect(
    page.getByRole('heading', { name: 'Development environment · simulated payment' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The book is in your library' })).toBeVisible();
  await page.getByRole('link', { name: 'Go to the book' }).click();
  await page.waitForURL((url) => url.pathname.startsWith(`/libri/${first}`));
  await expect(page.getByRole('link', { name: 'Read now' })).toBeVisible();

  // A second book, cancelled: "Try again" leads back to it.
  const second = await openBuyableBook(page, [first]);
  await page.getByRole('button', { name: 'Buy the book' }).click();
  await page.waitForURL(CHECKOUT_URL);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The payment was cancelled' })).toBeVisible();
  const retry = page.getByRole('link', { name: 'Try again' });
  await expect(retry).toBeVisible();
  await retry.click();
  await page.waitForURL((url) => url.pathname.startsWith(`/libri/${second}`));
  await expect(page.getByRole('button', { name: 'Buy the book' })).toBeVisible();
});
