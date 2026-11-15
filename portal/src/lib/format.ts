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
  const locale = localeFor(lang);
  const text = new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
  return text.slice(0, 1).toLocaleUpperCase(locale) + text.slice(1);
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

/** "3 Nov": a short day label for chart axes, with the month name capitalised in every language. */
export function formatDay(iso: string, lang: Language): string {
  const locale = localeFor(lang);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(new Date(iso))
    .map((part) =>
      part.type === 'month'
        ? part.value.slice(0, 1).toLocaleUpperCase(locale) + part.value.slice(1)
        : part.value,
    )
    .join('');
}

/** An event time, shown in the viewer's own time zone (unlike report buckets, which are UTC). */
export function formatDateTime(iso: string, lang: Language): string {
  return new Intl.DateTimeFormat(localeFor(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/** The last day inside a range whose `to` is exclusive. */
export function lastDayOf(to: string): string {
  return new Date(Date.parse(`${to}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Display label for a summary bucket. The first bucket can start before the range, so clamp it. */
export function bucketLabel(
  periodStart: string,
  granularity: 'day' | 'week' | 'month',
  rangeFrom: string,
  lang: Language,
  style: 'axis' | 'table' = 'table',
): string {
  const start = periodStart < rangeFrom ? rangeFrom : periodStart;
  if (granularity === 'month') return formatMonth(periodStart, lang);
  const date = style === 'axis' ? formatDay(start, lang) : formatDate(start, lang);
  return granularity === 'week' ? i18n.t('analytics.weekOf', { lng: lang, date }) : date;
}

/** A file size such as "1.2 MB". Decimal units, matching the 100 MB upload limit. */
export function formatBytes(bytes: number, lang: Language): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const text = formatNumber(
    new Intl.NumberFormat(localeFor(lang), { maximumFractionDigits: unit === 0 ? 0 : 1 }),
    value,
    lang,
  );
  return `${text} ${units[unit]}`;
}
