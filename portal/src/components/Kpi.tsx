import { useTranslation } from 'react-i18next';
import { currentLanguage } from '../i18n';
import { formatChange } from '../lib/format';

type Props = { label: string; value: string; current: number; previous: number | undefined };

/** The change compares two backend-supplied totals; "—" when there is nothing to compare to. */
export default function Kpi({ label, value, current, previous }: Props) {
  const { t } = useTranslation();
  const lang = currentLanguage();
  const change =
    previous === undefined || previous === 0
      ? t('common.none')
      : formatChange((current - previous) / previous, lang);
  return (
    <div className="card kpi">
      <div className="muted">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="muted kpi-change">
        {change} {t('overview.vsPrevious')}
      </div>
    </div>
  );
}
