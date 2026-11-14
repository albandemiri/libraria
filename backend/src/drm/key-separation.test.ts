import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SRC = path.resolve(__dirname, '..');
const ALLOWED_JWT_SECRET = new Set(['config/env.ts', 'auth/tokens.ts', 'auth/portal-session.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('key separation', () => {
  const files = sourceFiles(SRC).filter((f) => !f.endsWith('key-separation.test.ts'));

  it('no source derives a book key', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('deriveBookKey'));
    assert.deepEqual(offenders, []);
  });

  it('JWT_SECRET is only referenced by config and the token modules', () => {
    const offenders = files
      .filter((f) => readFileSync(f, 'utf8').includes('JWT_SECRET'))
      .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
      // Tests may set or clear it to prove nothing is derived from it.
      .filter((f) => !ALLOWED_JWT_SECRET.has(f) && !f.endsWith('.test.ts'));
    assert.deepEqual(offenders, []);
  });
});
