import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the running Docker stack (web on :5174, API on :3000, demo data
 * loaded, PAYMENTS_MODE=simulated). Nothing is started here: `docker compose up -d` first.
 *
 * Playwright's own browser download does not work everywhere, so a system Chromium is used when
 * there is one: PLAYWRIGHT_CHROMIUM_PATH, else /usr/bin/chromium if it exists, else Playwright's.
 */
const SYSTEM_CHROMIUM = '/usr/bin/chromium';
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ||
  (existsSync(SYSTEM_CHROMIUM) ? SYSTEM_CHROMIUM : undefined);

export default defineConfig({
  testDir: './e2e',
  // The tests share one database; run them one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5174',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: executablePath ? { executablePath } : {},
      },
    },
  ],
});
