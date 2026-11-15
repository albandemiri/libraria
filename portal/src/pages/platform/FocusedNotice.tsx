import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import Notice from '../../components/Notice';
import local from './Platform.module.css';
import { adminErrorKey } from './adminErrors';

/** An error message that takes focus when it appears, so keyboard and screen-reader users land on it. */
export default function FocusedNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // A new failure is a new message: re-focus even if the text is the same.
  // biome-ignore lint/correctness/useExhaustiveDependencies: focus once per error object
  useEffect(() => {
    // Let a closing dialog finish handing focus back first.
    const id = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [error]);
  return (
    <div ref={ref} tabIndex={-1} className={local.focusable}>
      <Notice tone="error">{t(adminErrorKey(error))}</Notice>
    </div>
  );
}
