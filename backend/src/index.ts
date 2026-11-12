import { app } from './app';
import { env } from './config/env';
import { pool } from './db/pool';

const server = app.listen(env.PORT, () => {
  console.log(`Server is running on port ${env.PORT} (${env.NODE_ENV})`);
});

// Compose sends SIGTERM on `down`; drain in-flight requests and close the pool
// so Postgres is not left holding connections.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
