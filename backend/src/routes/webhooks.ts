import express, { type Request, type Response, Router } from 'express';
import { activeProvider } from '../commerce/providers';
import { processWebhook } from '../commerce/service';
import { WebhookVerificationError } from '../commerce/signature';
import { logger } from '../lib/logger';
import { AppError } from '../middleware/errors';

/**
 * Payment provider webhooks (spec 7.1 step 5, 7.2).
 *
 * Mounted BEFORE the global JSON parser: signatures are computed over the
 * exact bytes received, so the body must stay raw.
 *
 * Responses: 200 once the event is recorded (applied, ignored or duplicate),
 * so the provider stops retrying; 401 for an unverifiable request; 5xx on our
 * own failure, so the provider retries.
 */
export const webhooksRouter = Router();

webhooksRouter.post(
  '/:provider',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req: Request, res: Response) => {
    const provider = activeProvider();
    if (!provider || provider.name !== req.params.provider) {
      throw new AppError(404, 'Unknown payment provider', 'UNKNOWN_PAYMENT_PROVIDER');
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

    try {
      const result = await processWebhook(provider, rawBody, (name) => req.get(name));
      logger.info('payment webhook processed', {
        requestId: req.requestId,
        provider: provider.name,
        outcome: result.outcome,
        detail: result.detail,
        transactionId: result.transactionId,
      });
      res.json({ received: true, outcome: result.outcome });
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        // Possible forgery or replay (spec 17.8): worth an alert if it repeats.
        logger.warn('payment webhook rejected', {
          requestId: req.requestId,
          provider: provider.name,
          reason: error.reason,
        });
        throw new AppError(401, 'Webhook signature verification failed', 'INVALID_SIGNATURE');
      }
      throw error;
    }
  },
);
