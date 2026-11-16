import { useTranslation } from 'react-i18next';
import { Form, useLocation } from 'react-router';
import { LANGUAGES } from '../i18n';
import { useLang } from '../books/useLang';
import styles from './LanguageSwitch.module.css';

/** Works without JavaScript: a plain POST that sets the cookie and returns to this page. */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const current = useLang();
  const { pathname, search } = useLocation();
  return (
    <Form method="post" action="/gjuha" className={styles.form} aria-label={t('language.label')}>
      <input type="hidden" name="returnTo" value={`${pathname}${search}`} />
      {LANGUAGES.map((lang, index) => (
        <span key={lang} className={styles.item}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <button
            type="submit"
            name="lang"
            value={lang}
            className={styles.button}
            aria-current={lang === current ? 'true' : undefined}
            aria-label={t(`language.${lang}Name`)}
            lang={lang}
          >
            {t(`language.${lang}`)}
          </button>
        </span>
      ))}
    </Form>
  );
}
