import { env } from '../../config/env';
import { PaddleProvider } from './paddle';
import { SimulatedProvider } from './simulated';
import type { PaymentProvider } from './types';

let active: PaymentProvider | null | undefined;

/**
 * The provider selected by PAYMENTS_MODE, or null when payments are disabled.
 * Only the active provider's checkouts are created and webhooks accepted.
 */
export function activeProvider(): PaymentProvider | null {
  if (active !== undefined) return active;

  switch (env.PAYMENTS_MODE) {
    case 'paddle':
      // env.ts guarantees both are set in this mode.
      active = new PaddleProvider({
        apiKey: env.PADDLE_API_KEY as string,
        webhookSecret: env.PADDLE_WEBHOOK_SECRET as string,
        environment: env.PADDLE_ENVIRONMENT,
        toleranceSeconds: env.WEBHOOK_TOLERANCE_SECONDS,
      });
      break;
    case 'simulated':
      active = new SimulatedProvider(env.SIMULATED_WEBHOOK_SECRET, env.WEBHOOK_TOLERANCE_SECONDS);
      break;
    default:
      active = null;
  }
  return active;
}
