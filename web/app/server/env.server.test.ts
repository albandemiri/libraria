import { describe, expect, it } from 'vitest';
import { DEV_SESSION_SECRET, parseEnv } from './env.server';

describe('parseEnv', () => {
  it('applies the development defaults', () => {
    expect(parseEnv({})).toEqual({
      NODE_ENV: 'development',
      API_URL: 'http://localhost:3000',
      SESSION_SECRET: DEV_SESSION_SECRET,
      PUBLIC_ORIGIN: 'http://localhost:5174',
      PAYMENTS_MODE: 'simulated',
      PADDLE_CLIENT_TOKEN: undefined,
      PADDLE_ENVIRONMENT: 'sandbox',
      PORTAL_URL: 'http://localhost:5173',
    });
  });

  it('treats empty strings as unset', () => {
    const env = parseEnv({
      API_URL: '',
      SESSION_SECRET: '',
      PAYMENTS_MODE: '',
      PADDLE_CLIENT_TOKEN: '',
      PADDLE_ENVIRONMENT: '',
    });
    expect(env.API_URL).toBe('http://localhost:3000');
    expect(env.SESSION_SECRET).toBe(DEV_SESSION_SECRET);
    expect(env.PAYMENTS_MODE).toBe('simulated');
    expect(env.PADDLE_CLIENT_TOKEN).toBeUndefined();
    expect(env.PADDLE_ENVIRONMENT).toBe('sandbox');
  });

  it('refuses the dev session secret in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production', SESSION_SECRET: DEV_SESSION_SECRET })).toThrow(
      /SESSION_SECRET/,
    );
  });

  it('refuses an empty or missing session secret in production', () => {
    expect(() => parseEnv({ NODE_ENV: 'production', SESSION_SECRET: '' })).toThrow(
      /SESSION_SECRET/,
    );
    expect(() => parseEnv({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
  });

  it('accepts a real secret in production', () => {
    const env = parseEnv({ NODE_ENV: 'production', SESSION_SECRET: 'a-real-production-secret' });
    expect(env.SESSION_SECRET).toBe('a-real-production-secret');
  });

  it('rejects invalid values', () => {
    expect(() => parseEnv({ PAYMENTS_MODE: 'disabled' })).toThrow(/PAYMENTS_MODE/);
    expect(() => parseEnv({ API_URL: 'not a url' })).toThrow(/API_URL/);
  });
});
