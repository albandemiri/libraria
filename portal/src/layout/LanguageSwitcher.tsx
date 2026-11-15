import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Language, currentLanguage, storeLanguage } from '../i18n';
import styles from './LanguageSwitcher.module.css';

export default function LanguageSwitcher({ showLabel = false }: { showLabel?: boolean }) {
  const { t, i18n } = useTranslation();
  const active = currentLanguage();

  const choose = (lang: Language) => {
    storeLanguage(lang);
    document.documentElement.lang = lang;
    void i18n.changeLanguage(lang);
  };

  return (
    <fieldset className={styles.group}>
      <legend className={showLabel ? styles.legend : 'ui-sr-only'}>{t('language.label')}</legend>
      <div className={styles.switcher}>
        {LANGUAGES.map((lang) => (
          <button
            key={lang}
            type="button"
            className={styles.button}
            aria-pressed={active === lang}
            lang={lang}
            onClick={() => choose(lang)}
          >
            {t(`language.${lang}`)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
