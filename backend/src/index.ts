import express, { Request, Response } from 'express';
import { env } from './config/env';
import { pool } from './db/pool';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { authRouter } from './routes/auth';
import { booksRouter } from './routes/books';

const app = express();

app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', dbTime: result.rows[0].now });
  } catch (error) {
    console.error('Health check failed', error);
    res.status(503).json({ status: 'error', message: 'Database connection failed' });
  }
});

app.use('/auth', authRouter);
app.use('/books', booksRouter);

app.use(notFoundHandler);
app.use(errorHandler);

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
