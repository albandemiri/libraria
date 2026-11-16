import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './Breadcrumbs.module.css';

type Props = { items: Array<{ label: ReactNode; href?: string }> };

export function Breadcrumbs({ items }: Props) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('ui.breadcrumb')} className={styles.nav}>
      <ol className={styles.list}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static, ordered trail
            <li key={i} className={styles.item}>
              {item.href && !last ? (
                <a className={styles.link} href={item.href}>
                  {item.label}
                </a>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
              {last ? null : (
                <span className={styles.sep} aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
