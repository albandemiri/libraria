import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language, currentLanguage, storeLanguage } from '../i18n';

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const active = currentLanguage();

  const choose = (lang: Language) => {
    storeLanguage(lang);
    document.documentElement.lang = lang;
    void i18n.changeLanguage(lang);
  };

  return (
    <fieldset className="lang-switcher">
      <legend className="sr-only">{t('language.label')}</legend>
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          className="lang-button"
          aria-pressed={active === lang}
          lang={lang}
          onClick={() => choose(lang)}
        >
          {t(`language.${lang}`)}
        </button>
      ))}
    </fieldset>
  );
}
