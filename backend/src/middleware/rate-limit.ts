import type { Request, RequestHandler } from 'express';
import { AppError } from './errors';

/**
 * In-memory sliding-window rate limiting, per process (so per instance: a
 * deployment with several instances allows up to limit x instances). Good
 * enough to blunt abuse of expensive endpoints; not a substitute for edge limits.
 */

export interface RateLimitOptions {
  /** Namespaces the counters: two limiters never share a window. */
  name: string;
  limit: number;
  windowMs: number;
  key: (req: Request) => string;
}

/** Timestamps (ms) of the hits still inside each window, oldest first. */
const hits = new Map<string, number[]>();

/** Above this many tracked keys, expired windows are swept on the next hit. */
const SWEEP_THRESHOLD = 10_000;

function sweep(now: number, windows: Map<string, number>): void {
  for (const [id, timestamps] of hits) {
    const windowMs = windows.get(id.slice(0, id.indexOf('\0'))) ?? 0;
    const last = timestamps[timestamps.length - 1];
    if (last === undefined || last <= now - windowMs) hits.delete(id);
  }
}

const windowByName = new Map<string, number>();

/**
 * Records a hit for `key` and reports whether it is allowed. When it is not,
 * `retryAfterSeconds` says when the oldest counted hit leaves the window.
 * A denied attempt is not counted, so waiting is always enough to recover.
 */
export function consumeRateLimit(
  name: string,
  key: string,
  limit: number,
  windowMs: number,
): { allowed: true } | { allowed: false; retryAfterSeconds: number } {
  const now = Date.now();
  windowByName.set(name, Math.max(windowByName.get(name) ?? 0, windowMs));
  if (hits.size > SWEEP_THRESHOLD) sweep(now, windowByName);

  const id = `${name}\0${key}`;
  const recent = (hits.get(id) ?? []).filter((timestamp) => timestamp > now - windowMs);
  if (recent.length >= limit) {
    hits.set(id, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
  recent.push(now);
  hits.set(id, recent);
  return { allowed: true };
}

/** Answers 429 RATE_LIMITED with a Retry-After header once `limit` hits fall in `windowMs`. */
export function rateLimit(opts: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const result = consumeRateLimit(opts.name, opts.key(req), opts.limit, opts.windowMs);
    if (result.allowed) {
      next();
      return;
    }
    res.set('Retry-After', String(result.retryAfterSeconds));
    next(new AppError(429, 'Too many requests. Try again later.', 'RATE_LIMITED'));
  };
}

/** For tests. */
export function resetRateLimits(): void {
  hits.clear();
}
