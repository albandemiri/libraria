import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures in Paddle's format, also used by the simulated provider:
 *
 *   <header>: ts=<unix seconds>;h1=<hex HMAC-SHA256 of `${ts}:${rawBody}`>
 *
 * More than one h1 may be present while a secret is being rotated; any match
 * is accepted. The timestamp bounds replay of a captured request.
 */

export class WebhookVerificationError extends Error {
  constructor(readonly reason: string) {
    super(`Webhook verification failed: ${reason}`);
    this.name = 'WebhookVerificationError';
  }
}

function hmacHex(secret: string, timestamp: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}:`).update(rawBody).digest('hex');
}

export function signWebhook(rawBody: Buffer, secret: string, now: Date = new Date()): string {
  const ts = Math.floor(now.getTime() / 1000).toString();
  return `ts=${ts};h1=${hmacHex(secret, ts, rawBody)}`;
}

export function verifyWebhookSignature(
  header: string | undefined,
  rawBody: Buffer,
  secret: string,
  options: { now?: Date; toleranceSeconds: number },
): void {
  if (!header) {
    throw new WebhookVerificationError('missing signature header');
  }

  let ts: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 'ts') ts = value;
    else if (key === 'h1') signatures.push(value);
  }

  if (!ts || !/^\d{1,12}$/.test(ts)) {
    throw new WebhookVerificationError('missing or malformed timestamp');
  }
  if (signatures.length === 0) {
    throw new WebhookVerificationError('missing h1 signature');
  }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - Number(ts)) > options.toleranceSeconds) {
    throw new WebhookVerificationError('timestamp outside tolerance');
  }

  const expected = Buffer.from(hmacHex(secret, ts, rawBody), 'hex');
  const matches = signatures.some((signature) => {
    if (!/^[0-9a-f]+$/i.test(signature)) return false;
    const candidate = Buffer.from(signature, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });

  if (!matches) {
    throw new WebhookVerificationError('signature mismatch');
  }
}
