import * as RadixDialog from '@radix-ui/react-dialog';
import * as RadixTabs from '@radix-ui/react-tabs';
import { type ReactNode, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './Button';
import { CrossIcon } from './icons';
import styles from './Overlays.module.css';

type OverlayProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
};

/**
 * These dialogs are controlled and have no Radix Trigger, so Radix has nothing to return focus
 * to. Remember the opener while rendering the open transition (before focus moves into the
 * dialog) and restore it on close.
 */
function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== 'undefined') {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;
  return (event: Event) => {
    event.preventDefault();
    opener.current?.focus();
  };
}

function CloseButton() {
  const { t } = useTranslation();
  return (
    <RadixDialog.Close asChild>
      <IconButton label={t('ui.close')} size="sm">
        <CrossIcon />
      </IconButton>
    </RadixDialog.Close>
  );
}

/** A right-hand detail panel. Traps focus, closes on Esc, returns focus to the opener. */
export function SidePanel({ open, onOpenChange, title, children }: OverlayProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={styles.panel}
          aria-describedby={undefined}
          onCloseAutoFocus={returnFocus}
        >
          <div className={styles.header}>
            <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
            <CloseButton />
          </div>
          <div className={styles.body}>{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  actions,
  onOpenAutoFocus,
  onCloseAutoFocus,
  dismissible = true,
}: OverlayProps & {
  description?: string;
  actions: ReactNode;
  /** Where focus goes when the dialog opens; call `preventDefault` and focus something else. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Where focus goes when it closes. Replaces the default "back to whatever opened it". */
  onCloseAutoFocus?: (event: Event) => void;
  /** False: Esc, an outside click and the close button do nothing; only the actions close it. */
  dismissible?: boolean;
}) {
  const returnFocus = useReturnFocus(open);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={styles.overlay} />
        <RadixDialog.Content
          className={styles.dialog}
          onOpenAutoFocus={onOpenAutoFocus}
          onCloseAutoFocus={onCloseAutoFocus ?? returnFocus}
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div className={styles.header}>
            <div>
              <RadixDialog.Title className={styles.title}>{title}</RadixDialog.Title>
              {description && (
                <RadixDialog.Description className={styles.description}>
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            {dismissible && <CloseButton />}
          </div>
          <div className={styles.body}>{children}</div>
          <div className={styles.actions}>{actions}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export type TabItem = { value: string; label: string; panel: ReactNode };

export function Tabs({
  value,
  onValueChange,
  items,
  label,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: TabItem[];
  label: string;
}) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List className={styles.tabList} aria-label={label}>
        {items.map((item) => (
          <RadixTabs.Trigger key={item.value} value={item.value} className={styles.tab}>
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value}>
          {item.panel}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
