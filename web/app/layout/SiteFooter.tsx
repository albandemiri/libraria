import { useTranslation } from 'react-i18next';
import styles from './SiteFooter.module.css';

export function SiteFooter({ portalUrl }: { portalUrl?: string }) {
  const { t } = useTranslation();
  return (
    <footer className={styles.footer}>
      <div>
        <p className={styles.brand}>{t('app.name')}</p>
        <p>{t('footer.tagline')}</p>
      </div>
      <div>
        <h2 className={styles.heading}>{t('app.name')}</h2>
        <ul className={styles.list}>
          <li>{t('footer.about')}</li>
          <li>{t('footer.help')}</li>
          <li>{t('footer.contact')}</li>
        </ul>
      </div>
      <div>
        <h2 className={styles.heading}>{t('footer.legal')}</h2>
        <ul className={styles.list}>
          <li>{t('footer.terms')}</li>
          <li>{t('footer.privacy')}</li>
          <li>{t('footer.refunds')}</li>
        </ul>
      </div>
      <div>
        <h2 className={styles.heading}>{t('footer.publishers')}</h2>
        <ul className={styles.list}>
          <li>{portalUrl ? <a href={portalUrl}>{t('footer.portal')}</a> : t('footer.portal')}</li>
          <li>{t('footer.partner')}</li>
        </ul>
      </div>
    </footer>
  );
}
