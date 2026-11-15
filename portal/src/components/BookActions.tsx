import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Book } from '../api/types';
import { Button, Dialog, Field, IconButton, Input, Menu, MenuItem, MenuNote } from '../ui';
import { MoreIcon } from '../ui/icons';
import styles from './BookActions.module.css';
import Notice from './Notice';
import { IN_FLIGHT, lifecycleErrorKey, useBookActions } from './useBookActions';

type Step = 'unpublish' | 'archive' | 'delete' | null;

/** The title a publisher must type to delete: surrounding spaces ignored, case matters. */
export const titleMatches = (typed: string, title: string) => typed.trim() === title.trim();

/**
 * Publish, unpublish, archive, restore and delete for one book. `header` shows the primary
 * Publish or Unpublish button plus a More menu; `menu` (Catalog rows and cards) is the menu alone.
 * Withdrawn books are an admin takedown, so they get nothing.
 */
export default function BookActions({
  book,
  variant,
  onSettled,
}: {
  book: Book;
  variant: 'header' | 'menu';
  /** Called after a successful archive or restore, to put focus somewhere stable (the row may vanish). */
  onSettled?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const actions = useBookActions(book);
  const [step, setStep] = useState<Step>(null);
  const [typed, setTyped] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  // After a success the page decides where focus goes; otherwise a closing dialog hands it back.
  const handOver = useRef(false);

  const returnToTrigger = (event: Event) => {
    event.preventDefault();
    if (!handOver.current) triggerRef.current?.focus();
  };

  // Once the error dialog is up (and Radix has settled its own focus), the message takes focus.
  useEffect(() => {
    if (errorKey === null) return;
    const id = setTimeout(() => errorRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [errorKey]);

  if (book.status === 'withdrawn') return null;

  const archived = book.status === 'archived';
  const published = book.status === 'published';
  const canType = titleMatches(typed, book.title);
  const needsFile = !published && !book.hasAsset;

  async function run(action: () => Promise<unknown>, after?: () => void, movesFocus = false) {
    if (busy) return;
    setBusy(true);
    try {
      if ((await action()) === IN_FLIGHT) return;
      handOver.current = movesFocus;
      setStep(null);
      after?.();
    } catch (err) {
      setStep(null);
      setErrorKey(lifecycleErrorKey(err));
    } finally {
      setBusy(false);
    }
  }

  const ask = (next: Exclude<Step, null>) => {
    handOver.current = false;
    setTyped('');
    setStep(next);
  };

  const afterDelete = () => {
    // From the book page the book is gone, so go to the catalog; a row menu stays where it is.
    const target =
      variant === 'header' ? '/catalog' : { pathname: location.pathname, search: location.search };
    // Replace, so Back never returns to a book that no longer exists.
    navigate(target, { replace: true, state: { deleted: book.title } });
  };

  const confirmDelete = () => {
    if (canType) void run(actions.remove, afterDelete, true);
  };

  const onDeleteSubmit = (e: FormEvent) => {
    e.preventDefault();
    confirmDelete();
  };

  const close = (open: boolean) => {
    if (!open) setStep(null);
  };

  return (
    // React events bubble through portals, so a click inside a menu or dialog would otherwise reach
    // a clickable table row that contains this component and open the book.
    // biome-ignore lint/a11y/noStaticElementInteractions: only stops propagation; it is not a control
    // biome-ignore lint/a11y/useKeyWithClickEvents: only stops propagation; it is not a control
    <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
      {variant === 'header' && !archived && (
        <Button
          variant={published ? 'secondary' : 'primary'}
          loading={busy && step === null}
          disabled={needsFile}
          aria-describedby={needsFile ? hintId : undefined}
          onClick={() => (published ? ask('unpublish') : void run(actions.publish))}
        >
          {t(published ? 'bookForm.unpublish' : 'bookForm.publish')}
        </Button>
      )}
      <Menu
        trigger={
          <IconButton
            ref={triggerRef}
            label={t('lifecycle.moreFor', { title: book.title })}
            variant="secondary"
            size={variant === 'menu' ? 'sm' : 'md'}
          >
            <MoreIcon />
          </IconButton>
        }
      >
        {variant === 'menu' && book.status === 'ready' && (
          <MenuItem onSelect={() => void run(actions.publish)}>{t('bookForm.publish')}</MenuItem>
        )}
        {variant === 'menu' && published && (
          <MenuItem onSelect={() => ask('unpublish')}>{t('bookForm.unpublish')}</MenuItem>
        )}
        {archived ? (
          <MenuItem onSelect={() => void run(actions.restore, onSettled)}>
            {t('lifecycle.restore')}
          </MenuItem>
        ) : (
          <MenuItem onSelect={() => ask('archive')}>{t('lifecycle.archive')}</MenuItem>
        )}
        {book.canDelete ? (
          <MenuItem danger onSelect={() => ask('delete')}>
            {t('lifecycle.delete')}
          </MenuItem>
        ) : (
          <MenuNote>{t('lifecycle.cannotDelete')}</MenuNote>
        )}
      </Menu>
      {variant === 'header' && !archived && needsFile && (
        <p id={hintId} className={styles.hint}>
          {t('lifecycle.publishNeedsFile')}
        </p>
      )}

      <Dialog
        open={step === 'unpublish'}
        onOpenChange={close}
        onCloseAutoFocus={returnToTrigger}
        title={t('lifecycle.unpublishTitle')}
        description={t('lifecycle.unpublishBody')}
        actions={
          <>
            <Button onClick={() => setStep(null)}>{t('lifecycle.cancel')}</Button>
            <Button variant="primary" loading={busy} onClick={() => void run(actions.unpublish)}>
              {t('lifecycle.unpublishYes')}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>

      <Dialog
        open={step === 'archive'}
        onOpenChange={close}
        onCloseAutoFocus={returnToTrigger}
        title={t('lifecycle.archiveTitle')}
        description={t('lifecycle.archiveBody')}
        actions={
          <>
            <Button onClick={() => setStep(null)}>{t('lifecycle.cancel')}</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={() => void run(actions.archive, onSettled, true)}
            >
              {t('lifecycle.archiveYes')}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>

      <Dialog
        open={step === 'delete'}
        onOpenChange={close}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={returnToTrigger}
        title={t('lifecycle.deleteTitle')}
        description={t('lifecycle.deleteBody')}
        actions={
          <>
            <Button onClick={() => setStep(null)}>{t('lifecycle.cancel')}</Button>
            <Button variant="danger" loading={busy} disabled={!canType} onClick={confirmDelete}>
              {t('lifecycle.deleteYes')}
            </Button>
          </>
        }
      >
        <form onSubmit={onDeleteSubmit} noValidate>
          <Field
            label={t('lifecycle.deleteLabel')}
            hint={t('lifecycle.deleteHint', { title: book.title })}
          >
            {(p) => (
              <Input
                {...p}
                ref={titleRef}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setTyped(e.target.value)}
              />
            )}
          </Field>
        </form>
      </Dialog>

      <Dialog
        open={errorKey !== null}
        onOpenChange={(open) => !open && setErrorKey(null)}
        onCloseAutoFocus={returnToTrigger}
        title={t('lifecycle.errorTitle')}
        actions={<Button onClick={() => setErrorKey(null)}>{t('lifecycle.dismiss')}</Button>}
      >
        <div ref={errorRef} tabIndex={-1} className={styles.message}>
          <Notice tone="error">{t(`lifecycle.errors.${errorKey ?? 'generic'}`)}</Notice>
        </div>
      </Dialog>
    </div>
  );
}
