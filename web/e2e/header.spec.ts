import { expect, type Page, test } from '@playwright/test';

/**
 * The signed-in header on small phones: it must never be wider than the viewport. Uses the demo
 * reader from `seed:demo` (read-only: nothing is bought or changed).
 */
const READER = { email: 'leart.cela@lexues.example', password: 'Password123!' };

async function signIn(page: Page) {
  await page.goto('/hyr');
  await page.getByLabel('Email').fill(READER.email);
  await page.getByLabel('Password').fill(READER.password);
  await page.locator('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign out' })).toBeVisible();
}

for (const lang of ['sq', 'en'] as const) {
  for (const width of [360, 390]) {
    test(`signed-in header fits a ${width}px viewport (${lang})`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      const origin = baseURL ?? 'http://localhost:5174';
      await context.addCookies([{ name: 'libraria_lang', value: 'en', url: origin }]);
      const page = await context.newPage();
      await signIn(page);
      await context.addCookies([{ name: 'libraria_lang', value: lang, url: origin }]);
      for (const path of ['/', '/eksploro']) {
        await page.goto(path);
        const signOut = page
          .getByRole('banner')
          .getByRole('button', { name: lang === 'sq' ? 'Dil' : 'Sign out' });
        await expect(signOut).toBeVisible();
        const { scrollWidth, innerWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));
        expect(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(innerWidth);
        // The button stays inside the page padding and keeps a 44px touch target.
        const box = await signOut.boundingBox();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(innerWidth);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
        // The name is visually hidden on small phones but still in the accessibility tree.
        await expect(page.getByRole('banner').getByText('Leart Cela')).toBeAttached();
      }
      await context.close();
    });
  }
}
