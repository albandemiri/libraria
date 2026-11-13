import path from 'node:path';
import express, { type Request, type Response, Router } from 'express';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { requestContext } from './middleware/request-context';
import { authRouter } from './routes/auth';
import { booksRouter } from './routes/books';
import { libraryRouter } from './routes/library';
import { publisherRouter } from './routes/publisher';
import { transactionsRouter } from './routes/transactions';

export const API_PREFIX = '/api/v1';

export const app = express();

app.disable('x-powered-by');

// First, so every later log line and error body can carry the request ID.
app.use(requestContext);
app.use(express.json({ limit: '1mb' }));

// TODO(phase 3, spec 8.3/17.2): ciphertext is still served from a public
// static path. Replace with authorized download grants from private storage.
const assetsDir = path.resolve(process.cwd(), 'public/assets');
app.use('/assets', express.static(assetsDir));

// Unversioned: probed by infrastructure, not by API clients.
app.get('/health', async (req: Request, res: Response) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ status: 'ok', dbTime: result.rows[0].now });
  } catch (error) {
    logger.error('health check failed', { requestId: req.requestId, err: error });
    res.status(503).json({ status: 'error', message: 'Database connection failed' });
  }
});

const v1 = Router();
v1.use('/auth', authRouter);
v1.use('/books', booksRouter);
v1.use('/library', libraryRouter);
v1.use('/transactions', transactionsRouter);
v1.use('/publisher', publisherRouter);

app.use(API_PREFIX, v1);

app.use(notFoundHandler);
app.use(errorHandler);
