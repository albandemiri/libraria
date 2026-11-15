/**
 * The safety rules of `npm run seed:demo`, as pure functions so they can be tested without
 * a database.
 */

/** Hosts the demo may be loaded into: this machine, or the Compose service names. */
export const LOCAL_DATABASE_HOSTS = ['localhost', '127.0.0.1', '::1', 'db', 'postgres'] as const;

export const DEMO_RESET_COMMAND = 'docker compose down -v && docker compose up';

export interface DemoSeedEnv {
  NODE_ENV: string;
  PAYMENTS_MODE?: string;
  POSTGRES_HOST?: string;
}

function hostOf(env: DemoSeedEnv, databaseUrl?: string): string {
  if (databaseUrl) {
    try {
      // URL keeps the brackets around an IPv6 host.
      return new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    } catch {
      throw new Error('seed:demo refuses to run: the database URL cannot be read.');
    }
  }
  return (env.POSTGRES_HOST ?? '').toLowerCase();
}

/**
 * Throws unless this is a development run against a local database with the simulated
 * payment provider. The host comes from `databaseUrl` when given, else `POSTGRES_HOST`.
 */
export function assertDemoSeedAllowed(env: DemoSeedEnv, databaseUrl?: string): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('seed:demo is for local development and refuses to run in production.');
  }
  if (env.PAYMENTS_MODE !== 'simulated') {
    throw new Error('seed:demo needs PAYMENTS_MODE=simulated (the sandbox plays the provider).');
  }
  const host = hostOf(env, databaseUrl);
  if (!(LOCAL_DATABASE_HOSTS as readonly string[]).includes(host)) {
    throw new Error(
      `seed:demo refuses to run against "${host || 'an unknown host'}": ` +
        `only a local database is allowed (${LOCAL_DATABASE_HOSTS.join(', ')}).`,
    );
  }
}

export type DemoLoadState = 'absent' | 'complete' | 'partial';

export interface DemoFootprint {
  /** Demo publishers, readers and books found by their fixed ids. */
  publishers: number;
  readers: number;
  books: number;
  /** The `demo.loaded` row, written as the very last step of a load. */
  marker: boolean;
}

/** Nothing found: run. The marker: done. Anything without the marker: a load that did not finish. */
export function classifyDemoState(found: DemoFootprint): DemoLoadState {
  if (found.marker) return 'complete';
  if (found.publishers + found.readers + found.books > 0) return 'partial';
  return 'absent';
}

export function demoStateMessage(state: Exclude<DemoLoadState, 'absent'>): string {
  return state === 'complete'
    ? `Demo data is already loaded; nothing was changed.\nFor a fresh database, run: ${DEMO_RESET_COMMAND}`
    : 'A previous demo load did not finish: some demo data exists but the load was never ' +
        `completed. Nothing was changed.\nReset the database and run it again: ${DEMO_RESET_COMMAND}`;
}
