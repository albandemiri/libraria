import * as Dialog from '@radix-ui/react-dialog';
import { useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Sheet.module.css';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
};

/** A modal bottom sheet (phone filters). Radix supplies the focus trap, Escape and focus return. */
export function Sheet({ open, onOpenChange, title, children, footer }: Props) {
  const { t } = useTranslation();
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.sheet}
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            // Opened from an arbitrary button (no Dialog.Trigger): hand focus back to it.
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <div className={styles.grab} aria-hidden="true" />
          <div className={styles.header}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close className={styles.close}>{t('ui.close')}</Dialog.Close>
          </div>
          <div className={styles.body}>{children}</div>
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
