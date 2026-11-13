import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { checksum, loadMigrations, MIGRATIONS_DIR } from './migrate';

async function withDir(files: Record<string, string>, fn: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'libraria-migrations-'));
  try {
    for (const [name, sql] of Object.entries(files)) {
      await writeFile(path.join(dir, name), sql);
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('migrations', () => {
  it('ignores line-ending differences in checksums', () => {
    assert.equal(checksum('SELECT 1;\r\nSELECT 2;\r\n'), checksum('SELECT 1;\nSELECT 2;\n'));
  });

  it('detects content changes in checksums', () => {
    assert.notEqual(checksum('SELECT 1;'), checksum('SELECT 2;'));
  });

  it('loads the repository migrations in version order', async () => {
    const migrations = await loadMigrations(MIGRATIONS_DIR);
    assert.ok(migrations.length >= 1);
    assert.equal(migrations[0].version, '0001');
    const versions = migrations.map((migration) => migration.version);
    assert.deepEqual(versions, [...versions].sort());
  });

  it('sorts by version regardless of directory order', async () => {
    await withDir({ '0002_b.sql': 'SELECT 2;', '0001_a.sql': 'SELECT 1;' }, async (dir) => {
      const migrations = await loadMigrations(dir);
      assert.deepEqual(
        migrations.map((migration) => migration.name),
        ['0001_a.sql', '0002_b.sql'],
      );
    });
  });

  it('rejects badly named files', async () => {
    await withDir({ 'add-users.sql': 'SELECT 1;' }, async (dir) => {
      await assert.rejects(loadMigrations(dir), /does not match/);
    });
  });

  it('rejects duplicate versions', async () => {
    await withDir({ '0001_a.sql': 'SELECT 1;', '0001_b.sql': 'SELECT 2;' }, async (dir) => {
      await assert.rejects(loadMigrations(dir), /Duplicate migration version 0001/);
    });
  });
});
