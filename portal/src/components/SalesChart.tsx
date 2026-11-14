import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Metrics } from '../api/types';
import type { Language } from '../i18n';
import { formatDate, formatMoney } from '../lib/format';

type Props = {
  series: Array<{ periodStart: string } & Pick<Metrics, 'grossCents'>>;
  from: string;
  lang: Language;
};

export default function SalesChart({ series, from, lang }: Props) {
  const { t } = useTranslation();
  // The first week or month bucket can start before the selected range; label it with the range start.
  const data = series.map((p) => ({
    label: formatDate(p.periodStart < from ? from : p.periodStart, lang),
    grossCents: p.grossCents,
  }));
  return (
    <figure className="chart" aria-label={t('overview.chartLabel')}>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis tickFormatter={(v: number) => formatMoney(v, lang)} width={90} />
          <Tooltip formatter={(v) => formatMoney(Number(v), lang)} />
          <Area
            type="monotone"
            dataKey="grossCents"
            name={t('metrics.gross')}
            stroke="#2563eb"
            fill="#bfdbfe"
          />
        </AreaChart>
      </ResponsiveContainer>
    </figure>
  );
}
