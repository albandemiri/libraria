import { type ReactNode, useId } from 'react';
import styles from './Page.module.css';

/** A named region: a heading plus optional controls on the right. */
export default function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id} className={styles.h2}>
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
