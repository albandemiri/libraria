import { describe, expect, it } from 'vitest';
import en from './en.json';
import { initialLanguage, localeFor } from './index';
import sq from './sq.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === 'object'
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('translations', () => {
  it('have identical, non-empty key sets', () => {
    const enKeys = flatten(en).sort();
    const sqKeys = flatten(sq).sort();
    expect(enKeys.length).toBeGreaterThan(0);
    expect(sqKeys).toEqual(enKeys);
  });
});

describe('initialLanguage', () => {
  it('prefers Albanian when the browser lists it', () => {
    expect(initialLanguage(null, ['sq-AL', 'en'])).toBe('sq');
  });
  it('falls back to English for other browser languages', () => {
    expect(initialLanguage(null, ['de'])).toBe('en');
  });
  it('honours a valid stored choice over the browser', () => {
    expect(initialLanguage('en', ['sq'])).toBe('en');
  });
  it('ignores an invalid stored choice', () => {
    expect(initialLanguage('xx', ['sq'])).toBe('sq');
  });
});

describe('localeFor', () => {
  it('maps languages to Intl locales', () => {
    expect(localeFor('sq')).toBe('sq-AL');
    expect(localeFor('en')).toBe('en-IE');
  });
});
