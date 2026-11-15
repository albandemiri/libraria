import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Book } from '../api/types';
import { Button } from '../ui';
import BookStatusBadge from './BookStatusBadge';
import styles from './DistributionPanel.module.css';
import Notice from './Notice';
import { IN_FLIGHT, lifecycleErrorKey, useBookActions } from './useBookActions';

type Message = { tone: 'error' | 'info'; text: string };

/**
 * Publication status and the publish / unpublish actions, plus how DRM is applied. Shared by the
 * book page's Distribution tab and the editor's last section.
 */
export default function DistributionPanel({ book }: { book: Book }) {
  const { t } = useTranslation();
  const { publish, unpublish, pending } = useBookActions(book);
  const [message, setMessage] = useState<Message | null>(null);

  async function toggle(shouldPublish: boolean) {
    setMessage(null);
    try {
      if ((await (shouldPublish ? publish() : unpublish())) === IN_FLIGHT) return;
      setMessage({
        tone: 'info',
        text: t(shouldPublish ? 'distribution.published' : 'distribution.unpublished'),
      });
    } catch (err) {
      setMessage({ tone: 'error', text: t(`lifecycle.errors.${lifecycleErrorKey(err)}`) });
    }
  }

  const withdrawn = book.status === 'withdrawn';
  const archived = book.status === 'archived';
  const published = book.status === 'published';

  return (
    <div className={styles.panel}>
      <div className={styles.statusRow}>
        <span>{t('distribution.statusLabel')}</span>
        <BookStatusBadge status={book.status} />
      </div>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {withdrawn ? (
        <Notice tone="plain">{t('distribution.withdrawn')}</Notice>
      ) : (
        <>
          <p className={styles.text}>{t(`distribution.explain.${book.status}`)}</p>
          {!archived && (
            <div className={styles.actions}>
              <Button
                variant={published ? 'secondary' : 'primary'}
                loading={pending}
                onClick={() => void toggle(!published)}
              >
                {t(published ? 'bookForm.unpublish' : 'bookForm.publish')}
              </Button>
            </div>
          )}
        </>
      )}
      <div className={styles.drm}>
        <h3>{t('distribution.drmTitle')}</h3>
        <p className={styles.text}>{t('distribution.drm')}</p>
      </div>
    </div>
  );
}
