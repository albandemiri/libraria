import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation } from 'react-router-dom';
import { useRangeUrlRewrite } from '../lib/useDateRange';
import { LoadingState } from '../ui';
import { PublisherScopeProvider } from './PublisherScope';
import styles from './Shell.module.css';
import { NavDrawer, Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { usesDateRange } from './navItems';

const COLLAPSED_KEY = 'libraria.portal.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function AppShell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement | null>(null);

  // Choosing a destination in the drawer should dismiss it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every route change
  useEffect(() => setDrawerOpen(false), [pathname]);

  useRangeUrlRewrite(usesDateRange(pathname));

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      // Storage unavailable; the choice lasts for this session only.
    }
  };

  return (
    <PublisherScopeProvider>
      <div className={styles.shell} data-collapsed={collapsed}>
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <NavDrawer open={drawerOpen} onOpenChange={setDrawerOpen} returnFocusTo={menuButton} />
        <div className={styles.main}>
          <TopBar menuButtonRef={menuButton} onOpenMenu={() => setDrawerOpen(true)} />
          <main className={styles.content}>
            <Suspense fallback={<LoadingState label={t('common.loading')} />}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </PublisherScopeProvider>
  );
}
