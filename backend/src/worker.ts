import { env } from './config/env';
import { pool } from './db/pool';
import { purgeExpiredDownloadGrants } from './drm/asset-delivery.service';
import { processNextJob, sweepQuarantine } from './drm/asset-ingestion.service';
import { logger } from './lib/logger';

/**
 * The asset-ingestion worker: a separate process from the API (own compose
 * service) so heavy parsing and scanning can never starve request handling.
 * Polls asset_jobs; sleeps one second when idle. Logs ids and codes only.
 */

const IDLE_MS = 1000;
const ERROR_MS = 5000;
const SWEEP_EVERY_MS = 10 * 60 * 1000;

let stopping = false;
let wake: (() => void) | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wake = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function main(): Promise<void> {
  logger.info('asset worker started', {
    nodeEnv: env.NODE_ENV,
    scanner: env.SCANNER,
    processingTimeoutMs: env.ASSET_PROCESSING_TIMEOUT_MS,
  });
  let lastSweep = 0;

  while (!stopping) {
    try {
      if (Date.now() - lastSweep >= SWEEP_EVERY_MS) {
        lastSweep = Date.now();
        const removed = await sweepQuarantine();
        if (removed > 0) logger.info('quarantine sweep removed objects', { removed });
        const purged = await purgeExpiredDownloadGrants();
        if (purged > 0) logger.info('purged expired download grants', { purged });
      }
      if ((await processNextJob()) === 'idle') await sleep(IDLE_MS);
    } catch (error) {
      // A database or storage outage: keep the process alive and try again.
      logger.error('worker loop error', {
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      await sleep(ERROR_MS);
    }
  }
}

// Finish the job in hand, then stop: a job killed midway is only reclaimed
// after its lock goes stale.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info('asset worker stopping', { signal });
    stopping = true;
    wake?.();
  });
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('asset worker crashed', {
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
