import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseEnv } from './env';

const STRONG_SECRET = 'x'.repeat(48);

describe('parseEnv', () => {
  it('defaults to simulated payments outside production', () => {
    assert.equal(parseEnv({ NODE_ENV: 'development' }).PAYMENTS_MODE, 'simulated');
    assert.equal(parseEnv({ NODE_ENV: 'test' }).PAYMENTS_MODE, 'simulated');
  });

  it('defaults to disabled payments in production', () => {
    const env = parseEnv({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET });
    assert.equal(env.PAYMENTS_MODE, 'disabled');
  });

  it('refuses simulated payments in production', () => {
    assert.throws(
      () =>
        parseEnv({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET, PAYMENTS_MODE: 'simulated' }),
      /PAYMENTS_MODE=simulated/,
    );
  });

  it('refuses the development JWT secret in production', () => {
    assert.throws(() => parseEnv({ NODE_ENV: 'production' }), /development default/);
  });

  it('refuses a short JWT secret in production', () => {
    assert.throws(
      () => parseEnv({ NODE_ENV: 'production', JWT_SECRET: 'short-but-not-default' }),
      /at least 32 characters/,
    );
  });

  it('rejects unknown enum values with a readable message', () => {
    assert.throws(() => parseEnv({ PAYMENTS_MODE: 'stripe' }), /PAYMENTS_MODE/);
  });
});

describe('parseEnv: payments', () => {
  it('requires Paddle credentials in paddle mode, treating empty values as unset', () => {
    assert.throws(
      () => parseEnv({ PAYMENTS_MODE: 'paddle', PADDLE_API_KEY: '', PADDLE_WEBHOOK_SECRET: '' }),
      /requires PADDLE_API_KEY/,
    );
    const env = parseEnv({
      PAYMENTS_MODE: 'paddle',
      PADDLE_API_KEY: 'pdl_sdbx_apikey_x',
      PADDLE_WEBHOOK_SECRET: 'pdl_ntfset_x',
    });
    assert.equal(env.PADDLE_ENVIRONMENT, 'sandbox');
    assert.equal(env.WEBHOOK_TOLERANCE_SECONDS, 5);
  });

  it('accepts empty Paddle values when payments are simulated', () => {
    const env = parseEnv({ PADDLE_API_KEY: '', PADDLE_WEBHOOK_SECRET: '' });
    assert.equal(env.PAYMENTS_MODE, 'simulated');
    assert.equal(env.PADDLE_API_KEY, undefined);
  });
});
