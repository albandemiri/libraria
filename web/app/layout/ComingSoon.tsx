import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '../ui';
import styles from './ComingSoon.module.css';

export type ComingSoonKind = 'library' | 'lists' | 'reader';

export function ComingSoon({ kind, bookId }: { kind: ComingSoonKind; bookId?: string }) {
  const { t } = useTranslation();
  const back =
    kind === 'reader' && bookId
      ? { to: `/libri/${encodeURIComponent(bookId)}`, label: t('comingSoon.reader.back') }
      : { to: '/', label: t('comingSoon.home') };
  return (
    <section className={styles.page}>
      <p className={styles.badge}>{t('comingSoon.badge')}</p>
      <h1 className={styles.title}>{t(`comingSoon.${kind}.title`)}</h1>
      <p className={styles.body}>{t(`comingSoon.${kind}.body`)}</p>
      <Button asChild variant="secondary">
        <Link to={back.to}>{back.label}</Link>
      </Button>
    </section>
  );
}
