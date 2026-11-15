import * as RadixMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import styles from './Menu.module.css';

/** A button that opens a menu of actions. Arrow keys, Home/End, type-ahead and Esc come from Radix. */
export function Menu({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>{trigger}</RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content className={styles.content} align="end" sideOffset={4}>
          {children}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}

export function MenuItem({
  onSelect,
  danger = false,
  children,
}: {
  onSelect: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <RadixMenu.Item className={`${styles.item} ${danger ? styles.danger : ''}`} onSelect={onSelect}>
      {children}
    </RadixMenu.Item>
  );
}

/** Explanatory text inside a menu; not an action. */
export function MenuNote({ children }: { children: ReactNode }) {
  return <RadixMenu.Label className={styles.note}>{children}</RadixMenu.Label>;
}
