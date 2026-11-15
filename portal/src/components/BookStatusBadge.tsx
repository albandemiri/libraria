import { useTranslation } from 'react-i18next';
import type { BookStatus } from '../api/types';
import { StatusBadge, type Tone } from '../ui';

const TONE: Record<BookStatus, Tone> = {
  draft: 'neutral',
  processing: 'pending',
  ready: 'info',
  published: 'positive',
  archived: 'neutral',
  withdrawn: 'negative',
};

/** The server-derived publisher status of a book, with a glyph and a label. */
export default function BookStatusBadge({ status }: { status: BookStatus }) {
  const { t } = useTranslation();
  return <StatusBadge tone={TONE[status]}>{t(`catalog.status.${status}`)}</StatusBadge>;
}
