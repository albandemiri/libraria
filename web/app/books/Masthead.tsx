import { useTranslation } from 'react-i18next';
import type { Lang } from '../i18n';
import { formatDate } from '../lib/format';
import type { DiscoverResponse } from '../lib/types';
import styles from './Masthead.module.css';
import { useLang } from './useLang';

type Props = { issue: DiscoverResponse['issue']; lang?: Lang };

/** The issue line of the magazine masthead: week and date, the weekly pick, and the catalogue size. */
export function Masthead({ issue, lang }: Props) {
  const { t } = useTranslation();
  const language = useLang(lang);
  return (
    <div className={styles.issue}>
      <span>
        {t('masthead.week', { week: issue.isoWeek })} · {formatDate(issue.date, language, 'day')}
      </span>
      <span className={styles.pick}>{t('masthead.pick')}</span>
      <span>
        {t('masthead.books', { count: issue.bookCount })} ·{' '}
        {t('masthead.publishers', { count: issue.publisherCount })}
      </span>
    </div>
  );
}
