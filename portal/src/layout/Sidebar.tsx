import * as RadixDialog from '@radix-ui/react-dialog';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, useSearchParams } from 'react-router-dom';
import { IconButton } from '../ui';
import { CrossIcon } from '../ui/icons';
import styles from './Shell.module.css';
import { CollapseIcon, NavIcon } from './navIcons';
import { PublisherSelect } from './PublisherSelect';
import { NAV_GROUPS, usesDateRange } from './navItems';

function Brand() {
  const { t } = useTranslation();
  return (
    <div className={styles.brand}>
      <span className={styles.wordmark}>{t('app.name')}</span>
      <span className={styles.tagline}>{t('app.tagline')}</span>
    </div>
  );
}

function NavGroups({ collapsed }: { collapsed: boolean }) {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  // The shared range rides along to range pages so it survives navigation.
  const from = params.get('from');
  const to = params.get('to');
  const rangeSearch = from && to ? `?${new URLSearchParams({ from, to })}` : '';
  return (
    <nav aria-label={t('nav.label')} className={styles.nav}>
      {NAV_GROUPS.map((group) => (
        <div key={group.key} className={styles.group}>
          <h2 className={collapsed ? `${styles.groupLabel} ui-sr-only` : styles.groupLabel}>
            {t(`nav.groups.${group.key}`)}
          </h2>
          <ul className={styles.list}>
            {group.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={{ pathname: item.to, search: usesDateRange(item.to) ? rangeSearch : '' }}
                  end={item.end}
                  className={styles.link}
                  title={collapsed ? t(`nav.${item.key}`) : undefined}
                >
                  <NavIcon name={item.key} />
                  <span className={collapsed ? 'ui-sr-only' : styles.linkLabel}>
                    {t(`nav.${item.key}`)}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** The persistent desktop sidebar (hidden by CSS below 900px, where the drawer takes over). */
export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <aside className={styles.sidebar} data-collapsed={collapsed}>
      <div className={styles.sidebarHead}>
        {!collapsed && <Brand />}
        <IconButton
          label={collapsed ? t('nav.expand') : t('nav.collapse')}
          aria-expanded={!collapsed}
          size="sm"
          onClick={onToggle}
        >
          <CollapseIcon flipped={collapsed} />
        </IconButton>
      </div>
      {!collapsed && (
        <div className={styles.scope}>
          <PublisherSelect />
        </div>
      )}
      <NavGroups collapsed={collapsed} />
    </aside>
  );
}

/** The small-screen navigation: a Radix dialog, so focus is trapped, Esc closes and focus returns. */
export function NavDrawer({
  open,
  onOpenChange,
  returnFocusTo,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.scrim} />
        <RadixDialog.Content
          className={styles.drawer}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusTo.current?.focus();
          }}
        >
          <div className={styles.sidebarHead}>
            <Brand />
            <RadixDialog.Close asChild>
              <IconButton label={t('ui.close')} size="sm">
                <CrossIcon />
              </IconButton>
            </RadixDialog.Close>
          </div>
          <RadixDialog.Title className="ui-sr-only">{t('nav.drawerTitle')}</RadixDialog.Title>
          <div className={styles.scope}>
            <PublisherSelect />
          </div>
          <NavGroups collapsed={false} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
