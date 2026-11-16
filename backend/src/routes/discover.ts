import { type Request, type Response, Router } from 'express';
import { optionalAuth } from '../middleware/auth';
import { buildDiscover } from '../storefront/discover.service';

export const discoverRouter = Router();

discoverRouter.get('/', optionalAuth, async (req: Request, res: Response) => {
  res.json(await buildDiscover(req.auth?.userId ?? null, new Date()));
});
