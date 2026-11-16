import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionUser } from '../lib/types';
import { MobileNav } from './MobileNav';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import styles from './SiteShell.module.css';

export function SiteShell({
  user,
  portalUrl,
  children,
}: {
  user: SessionUser | null;
  portalUrl?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#main">
        {t('header.skip')}
      </a>
      <SiteHeader user={user} />
      <main id="main" className={styles.main}>
        {children}
      </main>
      <SiteFooter portalUrl={portalUrl} />
      <MobileNav />
    </div>
  );
}
