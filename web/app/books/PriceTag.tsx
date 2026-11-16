import { useTranslation } from 'react-i18next';
import type { Lang } from '../i18n';
import { formatPrice } from '../lib/format';
import type { StoreBook } from '../lib/types';
import styles from './PriceTag.module.css';
import { useLang } from './useLang';

type Props = { book: Pick<StoreBook, 'price' | 'owned' | 'forSale'>; lang?: Lang };

export function PriceTag({ book, lang }: Props) {
  const { t } = useTranslation();
  const language = useLang(lang);

  if (book.owned) return <span className={`${styles.tag} ${styles.owned}`}>{t('book.owned')}</span>;
  if (!book.forSale) {
    return <span className={`${styles.tag} ${styles.muted}`}>{t('book.notForSale')}</span>;
  }
  return (
    <span className={styles.tag}>
      {formatPrice(book.price.amountCents, book.price.currency, language)}
    </span>
  );
}
