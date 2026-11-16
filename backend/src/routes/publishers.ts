import { type Request, type Response, Router } from 'express';
import { z } from 'zod';
import { AppError } from '../middleware/errors';
import { publisherSummaries } from '../storefront/publishers';

export const publishersRouter = Router();

publishersRouter.get('/', async (_req: Request, res: Response) => {
  res.json({ publishers: await publisherSummaries() });
});

publishersRouter.get('/:id', async (req: Request, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const [publisher] = id.success ? await publisherSummaries([id.data]) : [];
  if (!publisher) throw new AppError(404, 'Publisher not found', 'NOT_FOUND');
  res.json({ publisher });
});
