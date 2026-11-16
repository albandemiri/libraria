import { describe, expect, it } from 'vitest';
import {
  bookHref,
  coverSrc,
  coverSrcById,
  formatDate,
  formatIsbn13,
  formatPrice,
  slugify,
} from './format';

describe('format', () => {
  it('formats prices per language', () => {
    expect(formatPrice(599, 'EUR', 'sq')).toBe('5,99\u00a0€');
    expect(formatPrice(599, 'EUR', 'en')).toBe('€5.99');
  });

  it('formats dates in the reader language, in UTC', () => {
    expect(formatDate('2026-11-16T23:30:00Z', 'sq', 'day')).toBe('16 nëntor 2026');
    expect(formatDate('2026-11-16T00:00:00Z', 'en', 'month')).toBe('November 2026');
    expect(formatDate('2026-11-16T00:00:00Z', 'sq', 'month')).toBe('nëntor 2026');
  });

  it('groups an ISBN-13 and leaves anything else alone', () => {
    expect(formatIsbn13('9780000000095')).toBe('978-0-00-000009-5');
    expect(formatIsbn13('12345')).toBe('12345');
  });

  it('slugifies titles without diacritics', () => {
    expect(slugify('Zonja e Hanit të Bardhë')).toBe('zonja-e-hanit-te-bardhe');
    expect(slugify('Çudia: një  histori!')).toBe('cudia-nje-histori');
  });

  it('builds the book path', () => {
    expect(bookHref({ id: 'abc', title: 'Era e Marsit' })).toBe('/libri/abc/era-e-marsit');
  });

  it('maps cover URLs to the proxy and keeps the cache-buster', () => {
    const url = '/api/v1/books/abc/cover?v=3';
    expect(coverSrc({ id: 'abc', coverImageUrl: url })).toBe('/kopertina/abc?v=3');
    expect(coverSrc({ id: 'abc', coverImageUrl: url }, 'thumb')).toBe(
      '/kopertina/abc?v=3&size=thumb',
    );
    expect(coverSrc({ id: 'abc', coverImageUrl: '/api/v1/books/abc/cover' })).toBe(
      '/kopertina/abc',
    );
    expect(coverSrc({ id: 'abc', coverImageUrl: null })).toBeNull();
    expect(coverSrcById('abc', 'thumb')).toBe('/kopertina/abc?size=thumb');
    expect(coverSrcById('abc')).toBe('/kopertina/abc');
  });
});
