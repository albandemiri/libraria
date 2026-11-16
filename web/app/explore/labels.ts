import type { TFunction } from 'i18next';
import type { Lang } from '../i18n';
import type { Since } from './params';

const LOCALES: Record<Lang, string> = { sq: 'sq-AL', en: 'en-US' };

/** "10 €" / "€10" for whole euros, "9,99 €" otherwise. */
export function wholePrice(cents: number, lang: Lang): string {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat(LOCALES[lang], {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}

/** "Deri në 10 €". */
export const priceLabel = (t: TFunction, cents: number, lang: Lang) =>
  t('explore.filters.upTo', { price: wholePrice(cents, lang) });

/** "Shqip", "Anglisht", or the code in capitals for a language without a name. */
export const languageLabel = (t: TFunction, code: string) =>
  t(`explore.languages.${code}`, { defaultValue: code.toUpperCase() });

export const sinceLabel = (t: TFunction, since: Since, short = false) =>
  since === 'year'
    ? t('explore.filters.thisYear')
    : t(short ? 'explore.filters.last30Short' : 'explore.filters.last30');
