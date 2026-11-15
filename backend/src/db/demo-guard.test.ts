import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertDemoSeedAllowed, classifyDemoState, demoStateMessage } from './demo-guard';

const dev = { NODE_ENV: 'development', PAYMENTS_MODE: 'simulated', POSTGRES_HOST: 'localhost' };

describe('assertDemoSeedAllowed', () => {
  it('allows development with the simulated provider on every local host', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', 'db', 'postgres', 'LOCALHOST']) {
      assert.doesNotThrow(() => assertDemoSeedAllowed({ ...dev, POSTGRES_HOST: host }), host);
    }
    assert.doesNotThrow(() => assertDemoSeedAllowed({ ...dev, NODE_ENV: 'test' }));
  });

  it('reads the host from a database URL, brackets included', () => {
    assert.doesNotThrow(() => assertDemoSeedAllowed(dev, 'postgres://u:p@db:5432/libraria'));
    assert.doesNotThrow(() => assertDemoSeedAllowed(dev, 'postgres://u:p@[::1]:5432/libraria'));
    assert.throws(
      () => assertDemoSeedAllowed(dev, 'postgres://u:p@db.example.com:5432/x'),
      /local/,
    );
    assert.throws(() => assertDemoSeedAllowed(dev, 'not a url'), /cannot be read/);
  });

  it('refuses production', () => {
    assert.throws(() => assertDemoSeedAllowed({ ...dev, NODE_ENV: 'production' }), /production/);
  });

  it('refuses a payments mode other than simulated', () => {
    for (const mode of ['paddle', 'disabled', undefined]) {
      assert.throws(() => assertDemoSeedAllowed({ ...dev, PAYMENTS_MODE: mode }), /simulated/);
    }
  });

  it('refuses a remote or unknown host', () => {
    for (const host of ['prod-db.internal.example.com', '10.0.0.5', 'localhost.evil.com', '']) {
      assert.throws(
        () => assertDemoSeedAllowed({ ...dev, POSTGRES_HOST: host }),
        /only a local database/,
        host,
      );
    }
  });
});

describe('classifyDemoState', () => {
  const none = { publishers: 0, readers: 0, books: 0, marker: false };

  it('is absent when nothing is there', () => {
    assert.equal(classifyDemoState(none), 'absent');
  });

  it('is complete once the marker is there', () => {
    assert.equal(
      classifyDemoState({ publishers: 4, readers: 40, books: 62, marker: true }),
      'complete',
    );
  });

  it('is partial when demo rows exist without the marker', () => {
    assert.equal(classifyDemoState({ ...none, publishers: 4 }), 'partial');
    assert.equal(classifyDemoState({ ...none, readers: 3 }), 'partial');
    assert.equal(classifyDemoState({ ...none, books: 1 }), 'partial');
  });

  it('explains each stop, with the reset instructions', () => {
    assert.match(demoStateMessage('complete'), /already loaded.*down -v/s);
    assert.match(demoStateMessage('partial'), /did not finish.*down -v/s);
  });
});
