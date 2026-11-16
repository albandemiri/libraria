import { createInstance, type i18n } from 'i18next';
import en from './en.json';
import sq from './sq.json';

export const LANGUAGES = ['sq', 'en'] as const;
export type Lang = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Lang = 'sq';

export const resources = {
  sq: { translation: sq },
  en: { translation: en },
} as const;

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * A fresh i18next instance fixed to `lang`. The bundles are inline, so it is ready
 * synchronously: the server and the client render the same strings on the first pass.
 * Never share one instance between requests; create one per render tree and hand it to
 * react-i18next through <I18nextProvider> only (no initReactI18next, which would set a
 * process-wide default instance).
 */
export function createI18n(lang: Lang): i18n {
  const instance = createInstance();
  instance.init({
    lng: lang,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES,
    resources,
    initAsync: false,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  return instance;
}
