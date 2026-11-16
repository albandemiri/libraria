import { useTranslation } from 'react-i18next';
import { DEFAULT_LANGUAGE, isLang, type Lang } from '../i18n';

/** The language for formatting: an explicit prop, else the one the root layout gave the provider. */
export function useLang(explicit?: Lang): Lang {
  const { i18n } = useTranslation();
  if (explicit) return explicit;
  return isLang(i18n.language) ? i18n.language : DEFAULT_LANGUAGE;
}
