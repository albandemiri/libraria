import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import type { SessionUser } from '../lib/types';
import { SearchBox } from '../search/SearchBox';
import { AccountMenu } from './AccountMenu';
import { activeNav, NAV_ITEMS } from './destinations';
import { LanguageSwitch } from './LanguageSwitch';
import styles from './SiteHeader.module.css';

export function SiteHeader({ user }: { user: SessionUser | null }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const active = activeNav(pathname);
  return (
    <header className={styles.header}>
      <Link to="/" className={styles.wordmark} aria-label={t('header.home')}>
        {t('app.name')}
      </Link>
      <nav className={styles.nav} aria-label={t('nav.primary')}>
        {NAV_ITEMS.map((item) => (
          <Link
            key={item.key}
            to={item.href}
            className={styles.navLink}
            aria-current={active === item.key ? 'page' : undefined}
          >
            {t(`nav.${item.key}`)}
          </Link>
        ))}
      </nav>
      <search className={styles.search}>
        <SearchBox />
      </search>
      <Link to="/kerko" className={styles.searchLink}>
        {t('header.search')}
      </Link>
      <div className={styles.tools}>
        <LanguageSwitch />
        <AccountMenu user={user} />
      </div>
    </header>
  );
}
