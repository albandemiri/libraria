import { useTranslation } from 'react-i18next';
import { Form, Link, useLocation } from 'react-router';
import type { SessionUser } from '../lib/types';
import styles from './AccountMenu.module.css';

export function AccountMenu({ user }: { user: SessionUser | null }) {
  const { t } = useTranslation();
  const { pathname, search } = useLocation();
  if (!user) {
    return (
      <Link
        className={styles.link}
        to={`/hyr?returnTo=${encodeURIComponent(`${pathname}${search}`)}`}
      >
        {t('account.signIn')}
      </Link>
    );
  }
  return (
    <div className={styles.menu}>
      <span className={styles.name}>{user.displayName}</span>
      <Form method="post" action="/dil">
        <button type="submit" className={styles.link}>
          {t('account.signOut')}
        </button>
      </Form>
    </div>
  );
}
