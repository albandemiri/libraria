import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import LanguageSwitcher from '../layout/LanguageSwitcher';
import { Button } from '../ui';
import orgStyles from './Org.module.css';
import styles from './Page.module.css';
import Section from './Section';

const LATER = ['team', 'payment', 'profile'] as const;

/** Read-only account details, the live language switch and sign out, and what is coming later. */
export default function SettingsPage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('nav.settings')}</h1>

      <Section title={t('settings.account')}>
        <div className={styles.panel}>
          <dl className={orgStyles.details}>
            <div>
              <dt className={styles.heroLabel}>{t('settings.email')}</dt>
              <dd className={orgStyles.value}>{user?.email ?? t('common.none')}</dd>
            </div>
            <div>
              <dt className={styles.heroLabel}>{t('settings.displayName')}</dt>
              <dd className={orgStyles.value}>{user?.displayName ?? t('common.none')}</dd>
            </div>
          </dl>
          <p className={styles.muted}>{t('settings.accountNote')}</p>
        </div>
      </Section>

      <Section title={t('settings.language')}>
        <div className={styles.panel}>
          <LanguageSwitcher />
        </div>
      </Section>

      <Section title={t('settings.session')}>
        <div className={`${styles.panel} ${orgStyles.session}`}>
          <p className={styles.muted}>{t('settings.sessionBody')}</p>
          <Button onClick={() => void logout()}>{t('topbar.signOut')}</Button>
        </div>
      </Section>

      <Section title={t('settings.organization')}>
        <div className={`${styles.panel} ${orgStyles.org}`}>
          <Link to="/contracts" className={styles.link}>
            {t('settings.orgContract')}
          </Link>
          <p className={styles.muted}>{t('settings.orgContractBody')}</p>
        </div>
      </Section>

      <Section title={t('settings.later')}>
        <ul className={`${styles.panel} ${orgStyles.later}`}>
          {LATER.map((key) => (
            <li key={key}>
              <span className={orgStyles.name}>{t(`settings.laterItems.${key}.title`)}</span>
              <span className={styles.sub}>{t(`settings.laterItems.${key}.body`)}</span>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
