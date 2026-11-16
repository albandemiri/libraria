import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { activeNav, NAV_ITEMS } from './destinations';
import styles from './MobileNav.module.css';

export function MobileNav() {
  const { t } = useTranslation();
  const active = activeNav(useLocation().pathname);
  return (
    <nav className={styles.bar} aria-label={t('nav.mobile')}>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.key}
          to={item.href}
          className={styles.link}
          aria-current={active === item.key ? 'page' : undefined}
        >
          {t(`nav.${item.key}`)}
        </Link>
      ))}
    </nav>
  );
}
