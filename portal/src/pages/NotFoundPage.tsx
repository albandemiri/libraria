import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { EmptyState } from '../ui';
import styles from './Page.module.css';

/** Shown in place of a page the account may not open. It says nothing about what exists. */
export default function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className={styles.page}>
      <EmptyState
        title={t('notFound.title')}
        body={t('notFound.body')}
        action={
          <Link to="/" className={styles.link}>
            {t('notFound.home')}
          </Link>
        }
      />
    </div>
  );
}
