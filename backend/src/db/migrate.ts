import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from 'pg';

/**
 * Forward-only SQL migrations.
 *
 * Files in db/migrations named `NNNN_description.sql` are applied in order,
 * each inside its own transaction, and recorded in `schema_migrations` with a
 * checksum. An applied file that later changes is a hard error: shipped
 * migrations are history, and editing history makes environments diverge.
 *
 * Run as an explicit deployment step (`npm run migrate`), never implicitly on
 * application boot in production.
 */

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Arbitrary but fixed: serialises concurrent migrators (e.g. two deploys). */
const ADVISORY_LOCK_ID = 727_001;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

/**
 * Hashes with line endings normalised, so a Windows checkout with
 * core.autocrlf does not look like an edited migration.
 */
export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

export async function loadMigrations(dir = MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith('.sql')).sort();

  const migrations: Migration[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      throw new Error(`Migration file name "${file}" does not match NNNN_description.sql`);
    }

    const version = match[1];
    if (seen.has(version)) {
      throw new Error(`Duplicate migration version ${version}`);
    }
    seen.add(version);

    const sql = await readFile(path.join(dir, file), 'utf8');
    migrations.push({ version, name: file, sql, checksum: checksum(sql) });
  }

  return migrations;
}

export async function runMigrations(
  pool: Pool,
  options: { dir?: string; log?: (message: string) => void } = {},
): Promise<MigrationResult> {
  const log = options.log ?? (() => {});
  const migrations = await loadMigrations(options.dir);
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        checksum   TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const { rows } = await client.query<{ version: string; name: string; checksum: string }>(
      'SELECT version, name, checksum FROM schema_migrations ORDER BY version',
    );
    const applied = new Map(rows.map((row) => [row.version, row]));

    // Databases created by the old docker-entrypoint init.sql have the schema
    // but no migration history. Refuse rather than guess whether they match.
    if (rows.length === 0) {
      const legacy = await client.query<{ exists: boolean }>(
        `SELECT to_regclass('public.users') IS NOT NULL AS exists`,
      );
      if (legacy.rows[0]?.exists) {
        throw new Error(
          'Database already has tables but no migration history (it predates migrations). ' +
            'For a local dev database, recreate it: docker compose down -v && docker compose up',
        );
      }
    }

    const known = new Set(migrations.map((migration) => migration.version));
    for (const row of rows) {
      if (!known.has(row.version)) {
        throw new Error(
          `Database has migration ${row.name} which is missing from ${MIGRATIONS_DIR}. ` +
            'Is this checkout older than the database?',
        );
      }
    }

    const result: MigrationResult = { applied: [], alreadyApplied: [] };

    for (const migration of migrations) {
      const existing = applied.get(migration.version);

      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(
            `Migration ${migration.name} was modified after being applied. ` +
              'Revert the edit and add a new migration instead.',
          );
        }
        result.alreadyApplied.push(migration.name);
        continue;
      }

      log(`Applying ${migration.name}`);
      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${migration.name} failed: ${error instanceof Error ? error.message : error}`,
          { cause: error },
        );
      }
      result.applied.push(migration.name);
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ID]).catch(() => {});
    client.release();
  }
}

// CLI entry point: `npm run migrate` (dev) / `node dist/db/migrate.js` (prod).
if (require.main === module) {
  void (async () => {
    const { pool } = await import('./pool');
    try {
      const result = await runMigrations(pool, { log: (message) => console.log(message) });
      console.log(
        result.applied.length > 0
          ? `Applied ${result.applied.length} migration(s).`
          : `Database is up to date (${result.alreadyApplied.length} migration(s) applied).`,
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    } finally {
      await pool.end();
    }
  })();
}
