import { useTranslation } from 'react-i18next';
import type { SalesStatus } from '../api/types';
import { StatusBadge, type Tone } from '../ui';

const TONE: Record<SalesStatus, Tone> = {
  paid: 'positive',
  partially_refunded: 'info',
  refunded: 'negative',
  disputed: 'pending',
};

/** A sales line's own status, with a glyph and a label. */
export default function SalesStatusBadge({ status }: { status: SalesStatus }) {
  const { t } = useTranslation();
  return <StatusBadge tone={TONE[status]}>{t(`status.${status}`)}</StatusBadge>;
}
