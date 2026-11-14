import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loggablePath } from './request-context';

describe('loggablePath', () => {
  it('redacts a download token and drops the query string', () => {
    assert.equal(
      loggablePath('/api/v1/asset-downloads/abcDEF123_-xyz?x=1'),
      '/api/v1/asset-downloads/[redacted]',
    );
  });

  it('leaves other paths alone', () => {
    assert.equal(loggablePath('/api/v1/books/1?search=a'), '/api/v1/books/1');
  });
});
