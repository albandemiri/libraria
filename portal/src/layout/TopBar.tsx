import * as Popover from '@radix-ui/react-popover';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useDateRange } from '../lib/useDateRange';
import { Button, DateRangePicker, IconButton } from '../ui';
import LanguageSwitcher from './LanguageSwitcher';
import styles from './Shell.module.css';
import { MenuIcon } from './navIcons';
import { usesDateRange } from './navItems';

const PRESETS = ['this_month', 'last_month', 'last_90_days', 'this_year'] as const;

function RangeControl() {
  const { range, setRange } = useDateRange();
  return <DateRangePicker value={range} onChange={setRange} presets={[...PRESETS]} />;
}

function UserMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const name = user?.displayName ?? user?.email ?? '';
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={styles.userButton}>
          <span className={styles.avatar} aria-hidden="true">
            {name.slice(0, 1).toUpperCase()}
          </span>
          <span className={styles.userName}>{name}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className={styles.userMenu} align="end" sideOffset={6}>
          <p className={styles.menuLabel}>{t('topbar.signedInAs')}</p>
          {user?.displayName && <p className={styles.menuName}>{user.displayName}</p>}
          <p className={styles.menuEmail}>{user?.email}</p>
          <div className={styles.menuLanguage}>
            <LanguageSwitcher showLabel />
          </div>
          <Button className={styles.signOut} onClick={() => void logout()}>
            {t('topbar.signOut')}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function TopBar({
  menuButtonRef,
  onOpenMenu,
}: {
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  onOpenMenu: () => void;
}) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  return (
    <header className={styles.topbar}>
      <IconButton
        ref={menuButtonRef}
        label={t('nav.openMenu')}
        className={styles.menuButton}
        onClick={onOpenMenu}
      >
        <MenuIcon />
      </IconButton>

      <div className={styles.topRight}>
        {usesDateRange(pathname) && <RangeControl />}
        <UserMenu />
      </div>
    </header>
  );
}
