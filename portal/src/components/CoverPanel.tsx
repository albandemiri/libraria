import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCoverMutations } from '../api/books';
import { ApiError } from '../api/client';
import type { Book } from '../api/types';
import { readImageSize } from '../lib/image';
import { BookCover, Button, Dialog, FileDrop } from '../ui';
import styles from './CoverPanel.module.css';
import Notice from './Notice';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024;
const MIN_WIDTH = 400;
const SOFT_WIDTH = 1400;
const MAX_RATIO = 3;
const KNOWN = [
  'COVER_TOO_LARGE',
  'COVER_UNSUPPORTED_TYPE',
  'COVER_TOO_SMALL',
  'COVER_INVALID',
  'COVER_BAD_SHAPE',
  'COVER_BUSY',
  'PUBLISHER_ID_REQUIRED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'FORBIDDEN',
];
const SAFE_ORIGIN = '/api/v1/books/';

/** Our own error key for a failed call: the code if we know it, else what the status implies. */
function errorKey(err: unknown, withdrawn: boolean): string | null {
  if (!(err instanceof ApiError)) return 'generic';
  // A 401 is handled once, globally (back to the login page); no cover message on top.
  if (err.status === 401) return null;
  if (err.code === 'FORBIDDEN') return withdrawn ? 'FORBIDDEN' : 'FORBIDDEN_OTHER';
  if (KNOWN.includes(err.code)) return err.code;
  if (err.status === 413) return 'COVER_TOO_LARGE';
  if (err.status === 415) return 'COVER_UNSUPPORTED_TYPE';
  return 'generic';
}

/** The cover image of a book: preview, upload or replace, and remove. The server has the last word. */
export default function CoverPanel({ book }: { book: Book }) {
  const { t } = useTranslation();
  const { upload, remove } = useCoverMutations(book.id);
  // Keep the error as a code, so it is translated at render and follows a language switch.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [soft, setSoft] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const locked = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  const [inputTick, setInputTick] = useState(0);
  const withdrawn = book.status === 'withdrawn';
  const archived = book.status === 'archived';
  // An uploaded cover, or an old external link (which the server's DELETE resets).
  const removable =
    book.coverThumbUrl !== null ||
    (book.coverImageUrl !== null && !book.coverImageUrl.startsWith(SAFE_ORIGIN));

  // The error takes focus once the browser (or the closing dialog) has returned it elsewhere.
  useEffect(() => {
    if (focusTick === 0 || confirming) return;
    const id = setTimeout(() => errorRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [focusTick, confirming]);

  // After a removal the Remove button is gone; put focus on the upload control.
  useEffect(() => {
    if (inputTick === 0) return;
    const id = setTimeout(
      () => panelRef.current?.querySelector<HTMLInputElement>('input[type="file"]')?.focus(),
      0,
    );
    return () => clearTimeout(id);
  }, [inputTick]);

  function fail(code: string) {
    setErrorCode(code);
    setFocusTick((n) => n + 1);
  }

  function failWith(err: unknown) {
    const key = errorKey(err, withdrawn);
    if (key) fail(key);
  }

  async function onFile(file: File | undefined) {
    if (!file || locked.current || withdrawn || archived) return;
    locked.current = true;
    setChecking(true);
    try {
      setErrorCode(null);
      setSoft(false);
      // Some systems give no type for a file; the server decides then.
      if (file.type !== '' && !TYPES.includes(file.type)) return fail('COVER_UNSUPPORTED_TYPE');
      if (file.size > MAX_BYTES) return fail('COVER_TOO_LARGE');
      const size = await readImageSize(file);
      if (size) {
        if (size.width < MIN_WIDTH) return fail('COVER_TOO_SMALL');
        if (Math.max(size.width, size.height) > MAX_RATIO * Math.min(size.width, size.height)) {
          return fail('COVER_BAD_SHAPE');
        }
        setSoft(size.width < SOFT_WIDTH);
      }
      try {
        await upload.mutateAsync(file);
      } catch (err) {
        setSoft(false);
        failWith(err);
      }
    } finally {
      locked.current = false;
      setChecking(false);
    }
  }

  async function onRemove() {
    setConfirming(false);
    setErrorCode(null);
    setSoft(false);
    try {
      await remove.mutateAsync();
      setInputTick((n) => n + 1);
    } catch (err) {
      failWith(err);
    }
  }

  const busy = upload.isPending || remove.isPending || checking || withdrawn || archived;
  return (
    <div ref={panelRef} className={styles.panel}>
      {errorCode && (
        <div ref={errorRef} tabIndex={-1} className={styles.error}>
          <Notice tone="error">{t(`cover.errors.${errorCode}`)}</Notice>
        </div>
      )}
      {withdrawn && <Notice tone="plain">{t('cover.withdrawn')}</Notice>}
      {soft && !errorCode && <Notice tone="plain">{t('cover.lowRes')}</Notice>}
      <div className={styles.current}>
        <BookCover title={book.title} src={book.coverImageUrl} size="lg" />
        <div className={styles.side}>
          <div className={styles.drop}>
            <FileDrop
              title={t(removable ? 'cover.replace' : 'cover.upload')}
              accept={TYPES.join(',')}
              hint={t('cover.hint')}
              disabled={busy}
              onFiles={(files) => void onFile(files[0])}
            />
          </div>
          {removable && !withdrawn && !archived && (
            <div>
              <Button size="sm" disabled={busy} onClick={() => setConfirming(true)}>
                {t('cover.remove')}
              </Button>
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('cover.removeTitle')}
        description={t('cover.removeBody')}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>{t('cover.cancel')}</Button>
            <Button variant="danger" onClick={() => void onRemove()}>
              {t('cover.removeYes')}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </div>
  );
}
