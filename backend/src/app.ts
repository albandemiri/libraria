import express, { Request, Response } from 'express';
import { pool } from './db/pool';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { authRouter } from './routes/auth';
import { booksRouter } from './routes/books';
import { libraryRouter } from './routes/library';

export const app = express();

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
app.use('/library', libraryRouter);

app.use(notFoundHandler);
app.use(errorHandler);

