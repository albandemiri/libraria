/**
 * Test environment defaults. Imported first by harness.ts so these are set
 * before src/config/env.ts is evaluated (imports run in order; dotenv never
 * overrides variables that are already set).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.POSTGRES_DB ??= 'libraria_test';
process.env.BCRYPT_ROUNDS ??= '10';
process.env.PAYMENTS_MODE ??= 'simulated';
process.env.LOG_LEVEL ??= 'error';

// A private asset store per test process, removed on exit.
if (!process.env.ASSET_STORAGE_DIR) {
  const dir = mkdtempSync(path.join(tmpdir(), 'libraria-assets-'));
  process.env.ASSET_STORAGE_DIR = dir;
  process.on('exit', () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort: the OS temp directory is cleaned eventually.
    }
  });
}
