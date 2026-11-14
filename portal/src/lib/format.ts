import i18n, { type Language, localeFor } from '../i18n';

/**
 * ICU's sq-AL groups thousands with a space, but Albanian publishers write 1.234,50.
 * Use "." as the group separator for Albanian so numbers read the way users expect.
 */
function formatNumber(format: Intl.NumberFormat, value: number, lang: Language): string {
  return format
    .formatToParts(value)
    .map((part) => (lang === 'sq' && part.type === 'group' ? '.' : part.value))
    .join('');
}

export function formatMoney(cents: number, lang: Language): string {
  const format = new Intl.NumberFormat(localeFor(lang), {
    style: 'currency',
    currency: 'EUR',
    // sq-AL skips the thousands separator for 4-digit numbers by default.
    useGrouping: 'always',
  });
  return formatNumber(format, cents / 100, lang);
}

export function formatDate(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

export function countryName(code: string | null, lang: Language): string {
  if (code === null) return i18n.t('common.unknown', { lng: lang });
  try {
    return new Intl.DisplayNames([localeFor(lang)], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatPercentBps(bps: number, lang: Language): string {
  return new Intl.NumberFormat(localeFor(lang), {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/** Signed percentage change, e.g. "+12.5%". */
export function formatChange(ratio: number, lang: Language): string {
  return new Intl.NumberFormat(localeFor(lang), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(ratio);
}

export function formatMonth(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/**
 * Converts what a person typed ("9,99", "9.99", "10") into integer cents by string parsing.
 * Returns null for anything ambiguous: thousands separators, signs, letters, >2 decimals.
 */
export function parseEuroInput(text: string): number | null {
  const match = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const cents = Number(`${match[1]}${(match[2] ?? '').padEnd(2, '0')}`);
  return Number.isSafeInteger(cents) ? cents : null;
}
