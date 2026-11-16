import styles from './ProgressBar.module.css';

type Props = { value: number; label: string };

export function ProgressBar({ value, label }: Props) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
    >
      <div className={styles.fill} style={{ width: `${pct}%` }} />
    </div>
  );
}
