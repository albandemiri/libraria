import express, { type Request, type Response, Router } from 'express';
import { env } from './config/env';
import { pool } from './db/pool';
import { logger } from './lib/logger';
import { cors } from './middleware/cors';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { requestContext } from './middleware/request-context';
import { adminRouter } from './routes/admin';
import { assetsRouter, downloadsRouter } from './routes/assets';
import { uploadAssetHandlers } from './routes/assets-publisher';
import { uploadCoverHandlers } from './routes/covers-publisher';
import { authRouter } from './routes/auth';
import { booksRouter } from './routes/books';
import { devicesRouter } from './routes/devices';
import { libraryRouter } from './routes/library';
import { drmRouter, licencesRouter } from './routes/licences';
import { publisherRouter } from './routes/publisher';
import { sandboxRouter } from './routes/sandbox';
import { checkoutRouter, transactionsRouter } from './routes/transactions';
import { webhooksRouter } from './routes/webhooks';

export const API_PREFIX = '/api/v1';

export const app = express();

app.disable('x-powered-by');

// First, so every later log line and error body can carry the request ID.
app.use(requestContext);

// Before everything else so preflights never reach a router. Allowlist only.
app.use(cors(env.CORS_ORIGINS));

// Before express.json(): webhook signatures cover the raw request bytes.
app.use(`${API_PREFIX}/webhooks`, webhooksRouter);

// Also before express.json(): an EPUB upload is a raw body with its own, much
// larger, hard limit, and nothing may buffer it as JSON first.
app.post(`${API_PREFIX}/publisher/books/:bookId/assets`, ...uploadAssetHandlers);

// Same for a cover image: raw body, 10 MB limit, this route only.
app.put(`${API_PREFIX}/publisher/books/:bookId/cover`, ...uploadCoverHandlers);

app.use(express.json({ limit: '1mb' }));

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
v1.use('/devices', devicesRouter);
v1.use('/assets', assetsRouter);
v1.use('/asset-downloads', downloadsRouter);
v1.use('/licences', licencesRouter);
v1.use('/drm', drmRouter);
v1.use('/checkout-sessions', checkoutRouter);
v1.use('/transactions', transactionsRouter);
v1.use('/publisher', publisherRouter);
v1.use('/admin', adminRouter);

// Development only: lets the app and tests play the payment provider's part.
if (env.PAYMENTS_MODE === 'simulated') {
  v1.use('/sandbox', sandboxRouter);
}

app.use(API_PREFIX, v1);

app.use(notFoundHandler);
app.use(errorHandler);
