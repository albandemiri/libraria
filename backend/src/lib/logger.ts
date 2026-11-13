import { env } from '../config/env';

/**
 * Minimal structured logger: one JSON object per line, so logs can be shipped
 * to any aggregator without a parsing step.
 *
 * Redaction is by construction: callers pass explicit fields, and nothing here
 * logs request bodies, headers, tokens or keys. Keep it that way (spec 8.4,
 * 11.3, 17.8): never pass secrets, signed URLs or book content as a field.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const SEVERITY: Record<Level | 'silent', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export type LogFields = Record<string, unknown>;

function serialiseError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }
  return {
    name: error.name,
    message: error.message,
    // pg errors carry a SQLSTATE code, which is useful and not sensitive.
    ...((error as { code?: unknown }).code !== undefined && {
      code: (error as { code?: unknown }).code,
    }),
    stack: error.stack,
  };
}

function write(level: Level, message: string, fields: LogFields = {}): void {
  if (SEVERITY[level] < SEVERITY[env.LOG_LEVEL]) {
    return;
  }

  const { err, ...rest } = fields;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg: message,
    ...rest,
    ...(err !== undefined && { err: serialiseError(err) }),
  });

  (SEVERITY[level] >= SEVERITY.warn ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write('debug', message, fields),
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
