import type { ReactNode } from 'react';
import { CheckIcon, ClockIcon, CrossIcon, DashIcon, InfoIcon } from './icons';
import styles from './StatusBadge.module.css';

export type Tone = 'neutral' | 'positive' | 'pending' | 'negative' | 'info';

const DEFAULT_ICON: Record<Tone, ReactNode> = {
  neutral: <DashIcon />,
  positive: <CheckIcon />,
  pending: <ClockIcon />,
  negative: <CrossIcon />,
  info: <InfoIcon />,
};

/** Quiet status chip. Tone is always paired with a glyph and a text label. */
export function StatusBadge({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`}>
      <span className={styles.icon} aria-hidden="true">
        {icon ?? DEFAULT_ICON[tone]}
      </span>
      {children}
    </span>
  );
}
