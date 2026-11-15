import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { describe, it } from 'node:test';
import { parseEnv, refuseLocalStorageInProduction } from './env';

const STRONG_SECRET = 'x'.repeat(48);

describe('parseEnv', () => {
  it('defaults the asset pipeline limits and treats empty values as unset', () => {
    const env = parseEnv({ NODE_ENV: 'development' });
    assert.equal(env.ASSET_MAX_UPLOAD_BYTES, 104_857_600);
    assert.equal(env.ASSET_PROCESSING_TIMEOUT_MS, 60_000);
    assert.equal(env.CLAMAV_TIMEOUT_MS, 120_000);
    const blank = parseEnv({
      NODE_ENV: 'development',
      ASSET_MAX_UPLOAD_BYTES: '',
      ASSET_PROCESSING_TIMEOUT_MS: '',
      CLAMAV_TIMEOUT_MS: '',
    });
    assert.equal(blank.CLAMAV_TIMEOUT_MS, 120_000);
    assert.equal(
      parseEnv({ NODE_ENV: 'development', CLAMAV_TIMEOUT_MS: '5000' }).CLAMAV_TIMEOUT_MS,
      5000,
    );
  });

  it('defaults to simulated payments outside production', () => {
    assert.equal(parseEnv({ NODE_ENV: 'development' }).PAYMENTS_MODE, 'simulated');
    assert.equal(parseEnv({ NODE_ENV: 'test' }).PAYMENTS_MODE, 'simulated');
  });

  it('does not start in production while only the local KMS exists', () => {
    // PAYMENTS_MODE would default to disabled, but KMS_PROVIDER=local is refused first.
    assert.throws(
      () =>
        parseEnv({
          NODE_ENV: 'production',
          JWT_SECRET: STRONG_SECRET,
          PORTAL_ORIGIN: 'https://portal.example',
        }),
      /development DRM_LOCAL_KEK/,
    );
  });

  it('defaults PORTAL_ORIGIN in development and requires it in production', () => {
    assert.equal(parseEnv({ NODE_ENV: 'development' }).PORTAL_ORIGIN, 'http://localhost:5173');
    assert.equal(parseEnv({ PORTAL_ORIGIN: '' }).PORTAL_ORIGIN, 'http://localhost:5173');
    assert.equal(
      parseEnv({ PORTAL_ORIGIN: 'https://portal.example/' }).PORTAL_ORIGIN,
      'https://portal.example',
    );
    assert.throws(() => parseEnv({ PORTAL_ORIGIN: 'not a url' }), /PORTAL_ORIGIN/);
    assert.throws(() => parseEnv({ PORTAL_ORIGIN: 'https://portal.example/app' }), /PORTAL_ORIGIN/);
    assert.throws(
      () => parseEnv({ NODE_ENV: 'production', JWT_SECRET: STRONG_SECRET }),
      /PORTAL_ORIGIN is required/,
    );
  });

  it('accepts only a plain http(s) origin for PORTAL_ORIGIN, normalised', () => {
    assert.equal(
      parseEnv({ PORTAL_ORIGIN: 'https://Portal.Example:8443/' }).PORTAL_ORIGIN,
      'https://portal.example:8443',
    );
    assert.equal(
      parseEnv({ PORTAL_ORIGIN: 'http://localhost:5173' }).PORTAL_ORIGIN,
      'http://localhost:5173',
    );
    for (const bad of [
      'https://portal.example/app',
      'https://portal.example/?a=1',
      'https://portal.example/?',
      'https://portal.example/#x',
      'https://portal.example#',
      'https://user@portal.example',
      'https://user:pw@portal.example',
      'ftp://portal.example',
      'javascript:alert(1)',
      'portal.example',
    ]) {
      assert.throws(() => parseEnv({ PORTAL_ORIGIN: bad }), /PORTAL_ORIGIN/, bad);
    }
  });

  it('requires an https PORTAL_ORIGIN in production', () => {
    assert.throws(
      () =>
        parseEnv({
          NODE_ENV: 'production',
          JWT_SECRET: STRONG_SECRET,
          PORTAL_ORIGIN: 'http://portal.example',
        }),
      /must be an https origin/,
    );
  });

  it('reads TRUST_PROXY as off, a hop count or a list of trusted addresses', () => {
    assert.equal(parseEnv({}).TRUST_PROXY, 0);
    assert.equal(parseEnv({ TRUST_PROXY: '' }).TRUST_PROXY, 0);
    assert.equal(parseEnv({ TRUST_PROXY: '1' }).TRUST_PROXY, 1);
    assert.deepEqual(parseEnv({ TRUST_PROXY: '10.0.0.0/8, 172.16.0.0/12,loopback' }).TRUST_PROXY, [
      '10.0.0.0/8',
      '172.16.0.0/12',
      'loopback',
    ]);
    assert.throws(() => parseEnv({ TRUST_PROXY: 'yes' }), /TRUST_PROXY/);
    assert.throws(() => parseEnv({ TRUST_PROXY: '1,,2' }), /TRUST_PROXY/);
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

  it('splits CORS_ORIGINS into a trimmed list', () => {
    assert.deepEqual(
      parseEnv({ CORS_ORIGINS: 'https://a.example, https://b.example' }).CORS_ORIGINS,
      ['https://a.example', 'https://b.example'],
    );
    assert.deepEqual(parseEnv({}).CORS_ORIGINS, []);
  });

  it('defaults portal session lifetimes', () => {
    const env = parseEnv({});
    assert.equal(env.PORTAL_SESSION_HOURS, 12);
    assert.equal(env.PORTAL_REMEMBER_DAYS, 30);
  });
});

describe('parseEnv: DRM', () => {
  const prodBase = {
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_SECRET,
    PORTAL_ORIGIN: 'https://portal.example',
  } as const;
  const realKek = Buffer.alloc(32, 7).toString('base64');
  const realSigningKey = generateKeyPairSync('ed25519')
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();

  it('provides development defaults outside production', () => {
    const env = parseEnv({});
    assert.equal(env.KMS_PROVIDER, 'local');
    assert.equal(env.LICENCE_DAYS, 30);
    assert.equal(Buffer.from(env.DRM_LOCAL_KEK, 'base64').length, 32);
    assert.match(env.LICENCE_SIGNING_PRIVATE_KEY, /BEGIN PRIVATE KEY/);
  });

  it('refuses KMS_PROVIDER=local in production', () => {
    assert.throws(
      () =>
        parseEnv({
          ...prodBase,
          DRM_LOCAL_KEK: realKek,
          LICENCE_SIGNING_PRIVATE_KEY: realSigningKey,
          SCANNER: 'clamav',
        }),
      /KMS_PROVIDER=local/,
    );
  });

  it('refuses SCANNER=none in production', () => {
    const real = {
      ...prodBase,
      DRM_LOCAL_KEK: realKek,
      LICENCE_SIGNING_PRIVATE_KEY: realSigningKey,
    };
    assert.throws(() => parseEnv({ ...real, SCANNER: 'none' }), /SCANNER=none/);
    assert.throws(() => parseEnv(real), /SCANNER=none/);
  });

  it('refuses STORAGE_PROVIDER=local in production, independently of the other refusals', () => {
    assert.throws(() => refuseLocalStorageInProduction('local'), /STORAGE_PROVIDER=local/);
    // Wired into parseEnv: with every other production requirement met, the failure is
    // still a production refusal (KMS comes first today, storage right after it).
    const real = {
      ...prodBase,
      DRM_LOCAL_KEK: realKek,
      LICENCE_SIGNING_PRIVATE_KEY: realSigningKey,
    };
    assert.throws(() => parseEnv({ ...real, SCANNER: 'clamav' }), /not allowed in production/);
  });

  it('accepts STORAGE_PROVIDER=local outside production, rejects unknown providers', () => {
    assert.equal(parseEnv({}).STORAGE_PROVIDER, 'local');
    assert.equal(parseEnv({ STORAGE_PROVIDER: '' }).STORAGE_PROVIDER, 'local');
    assert.throws(() => parseEnv({ STORAGE_PROVIDER: 's3' }), /STORAGE_PROVIDER/);
  });

  it('defaults the scanner and storage settings outside production', () => {
    const env = parseEnv({});
    assert.equal(env.SCANNER, 'none');
    assert.equal(env.ASSET_STORAGE_DIR, './var/asset-storage');
    assert.equal(env.CLAMAV_PORT, 3310);
  });

  it('refuses the development KEK in production', () => {
    const dev = parseEnv({});
    assert.throws(
      () => parseEnv({ ...prodBase, DRM_LOCAL_KEK: dev.DRM_LOCAL_KEK }),
      /development DRM_LOCAL_KEK/,
    );
  });

  it('refuses the development signing key in production', () => {
    assert.throws(
      () => parseEnv({ ...prodBase, DRM_LOCAL_KEK: realKek }),
      /development LICENCE_SIGNING_PRIVATE_KEY/,
    );
  });

  it('refuses the development KEK in production even when unpadded', () => {
    const dev = parseEnv({}).DRM_LOCAL_KEK.replace(/=+$/, '');
    assert.throws(() => parseEnv({ ...prodBase, DRM_LOCAL_KEK: dev }), /development DRM_LOCAL_KEK/);
  });

  it('refuses the development signing key in production when trimmed or CRLF', () => {
    const pem = parseEnv({}).LICENCE_SIGNING_PRIVATE_KEY;
    for (const variant of [pem.trim(), pem.replaceAll('\n', '\r\n')]) {
      assert.throws(
        () =>
          parseEnv({ ...prodBase, DRM_LOCAL_KEK: realKek, LICENCE_SIGNING_PRIVATE_KEY: variant }),
        /development LICENCE_SIGNING_PRIVATE_KEY/,
      );
    }
  });

  it('rejects a non-base64 or all-zero DRM_LOCAL_KEK', () => {
    assert.throws(
      () => parseEnv({ DRM_LOCAL_KEK: Buffer.alloc(32).toString('base64') }),
      /DRM_LOCAL_KEK/,
    );
    assert.throws(() => parseEnv({ DRM_LOCAL_KEK: `${'!'.repeat(43)}=` }), /DRM_LOCAL_KEK/);
  });

  it('rejects a DRM_LOCAL_KEK that is not 32 bytes', () => {
    assert.throws(
      () => parseEnv({ DRM_LOCAL_KEK: Buffer.alloc(16).toString('base64') }),
      /DRM_LOCAL_KEK/,
    );
  });

  it('rejects a signing key that is not an Ed25519 PEM', () => {
    assert.throws(() => parseEnv({ LICENCE_SIGNING_PRIVATE_KEY: 'nope' }), /LICENCE_SIGNING/);
  });

  it('accepts a signing key with escaped newlines', () => {
    const pem = parseEnv({}).LICENCE_SIGNING_PRIVATE_KEY;
    const env = parseEnv({ LICENCE_SIGNING_PRIVATE_KEY: pem.trim().replace(/\n/g, '\n') });
    assert.match(env.LICENCE_SIGNING_PRIVATE_KEY, /\n/);
  });
});
