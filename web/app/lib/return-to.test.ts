import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it.each([
    '//evil.example',
    'https://evil.example',
    '\\\\evil',
    '/\\evil.example',
    '/a\nb',
    '/a\u0000b',
    'eksploro',
    '',
    null,
  ])('rejects %j', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });

  it('keeps a same-site path with its query string', () => {
    expect(safeReturnTo('/libri/42/zhurma?x=1#a')).toBe('/libri/42/zhurma?x=1#a');
    expect(safeReturnTo('/')).toBe('/');
  });
});
