import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import sq from './sq.json';

export const LANGUAGES = ['sq', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'libraria.portal.language';

function isLanguage(value: string | null): value is Language {
  return value !== null && (LANGUAGES as readonly string[]).includes(value);
}

export function initialLanguage(stored: string | null, browser: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  return browser.some((l) => l.toLowerCase().startsWith('sq')) ? 'sq' : 'en';
}

export function localeFor(lang: Language): 'sq-AL' | 'en-IE' {
  return lang === 'sq' ? 'sq-AL' : 'en-IE';
}

export function currentLanguage(): Language {
  return isLanguage(i18next.language) ? i18next.language : 'en';
}

export function storeLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // Storage may be unavailable (private mode); the choice just won't persist.
  }
}

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

const browserLanguages =
  typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);

void i18next.use(initReactI18next).init({
  resources: { en: { translation: en }, sq: { translation: sq } },
  lng: initialLanguage(readStoredLanguage(), browserLanguages),
  fallbackLng: 'en',
  supportedLngs: [...LANGUAGES],
  interpolation: { escapeValue: false },
});

export default i18next;
