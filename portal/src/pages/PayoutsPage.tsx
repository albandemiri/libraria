import { useTranslation } from 'react-i18next';
import { NotSetUpState } from '../ui';
import styles from './Page.module.css';
import Section from './Section';

/** Payouts are not built yet. Deliberately no figures and no requests. */
export default function PayoutsPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>{t('nav.payouts')}</h1>
      <Section title={t('earnings.balances')}>
        <NotSetUpState title={t('payouts.title')} body={t('payouts.body')} />
      </Section>
    </div>
  );
}
