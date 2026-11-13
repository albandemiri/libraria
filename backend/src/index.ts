import { app } from './app';
import { env } from './config/env';
import { pool } from './db/pool';
import { logger } from './lib/logger';

const server = app.listen(env.PORT, () => {
  logger.info('server listening', {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    paymentsMode: env.PAYMENTS_MODE,
  });
  if (env.PAYMENTS_MODE === 'simulated') {
    logger.warn('PAYMENTS_MODE=simulated: checkout grants books without taking payment');
  }
});

// Compose sends SIGTERM on `down`; drain in-flight requests and close the pool
// so Postgres is not left holding connections.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
