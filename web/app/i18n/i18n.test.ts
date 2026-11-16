import { describe, expect, it } from 'vitest';
import { detectLanguage } from '../server/i18n.server';
import en from './en.json';
import sq from './sq.json';

function flatKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost:5174/', { headers });
}

describe('i18n', () => {
  it('sq and en bundles have identical keys', () => {
    expect(flatKeys(en).sort()).toEqual(flatKeys(sq).sort());
  });

  it('detectLanguage prefers the cookie, then Accept-Language, then sq', () => {
    expect(detectLanguage(req({ cookie: 'libraria_lang=en' }))).toBe('en');
    expect(detectLanguage(req({ 'accept-language': 'sq-AL,en;q=0.8' }))).toBe('sq');
    expect(detectLanguage(req({ 'accept-language': 'de-DE' }))).toBe('sq');
    expect(detectLanguage(req({}))).toBe('sq');
    expect(
      detectLanguage(req({ cookie: 'libraria_lang=sq', 'accept-language': 'en-GB,en;q=0.9' })),
    ).toBe('sq');
    expect(detectLanguage(req({ cookie: 'libraria_lang=fr', 'accept-language': 'en' }))).toBe('en');
  });

  it('detectLanguage ignores a malformed cookie and falls through to Accept-Language', () => {
    expect(detectLanguage(req({ cookie: 'libraria_lang=%E0%A4%A', 'accept-language': 'en' }))).toBe(
      'en',
    );
    expect(detectLanguage(req({ cookie: 'other=%; libraria_lang=en' }))).toBe('en');
    expect(detectLanguage(req({ cookie: 'libraria_lang=%' }))).toBe('sq');
  });
});
