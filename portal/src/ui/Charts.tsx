import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import styles from './Charts.module.css';

export type ChartSeries = { key: string; label: string };
export type ChartDatum = Record<string, string | number>;

type Props = {
  data: ChartDatum[];
  xKey: string;
  series: ChartSeries[];
  /** Names the chart for assistive tech; also the start of its text summary. */
  ariaLabel: string;
  height?: number;
  formatValue?: (value: number) => string;
};

// Green first, burgundy second, then muted earth tones. Bars are also told apart by fill
// pattern so colour is never the only signal.
const COLORS = ['#263d32', '#793e43', '#8a7a52', '#5f7a6b'];

const AXIS = { fontSize: 12, fill: '#66655d' };

function useSummary({ data, xKey, ariaLabel }: Props) {
  const { t } = useTranslation();
  if (data.length === 0) return t('ui.chartEmpty', { label: ariaLabel });
  return t('ui.chartSummary', {
    label: ariaLabel,
    count: data.length,
    first: String(data[0]?.[xKey]),
    last: String(data[data.length - 1]?.[xKey]),
  });
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '');
const patternId = (uid: string, i: number) => `p${safeId(uid)}-${i}`;
const fillFor = (uid: string, i: number) =>
  i % COLORS.length === 0 ? COLORS[0] : `url(#${patternId(uid, i)})`;

/** Series 0 is solid; the rest use stripes, dots and a check, so bars differ by more than colour. */
function Patterns({ uid, count }: { uid: string; count: number }) {
  const bg = '#fffefa';
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        {Array.from({ length: count }, (_, i) => {
          const c = COLORS[i % COLORS.length];
          const id = patternId(uid, i);
          const shape = i % 4;
          if (shape === 0) return null;
          return (
            <pattern
              key={id}
              id={id}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform={shape === 1 ? 'rotate(45)' : undefined}
            >
              <rect width="6" height="6" fill={c} />
              {shape === 1 && <rect width="2.5" height="6" fill={bg} />}
              {shape === 2 && <circle cx="3" cy="3" r="1.3" fill={bg} />}
              {shape === 3 && <rect width="3" height="3" fill={bg} />}
            </pattern>
          );
        })}
      </defs>
    </svg>
  );
}

function Legend({ series, uid }: { series: ChartSeries[]; uid: string }) {
  const { t } = useTranslation();
  return (
    <ul className={styles.legend} aria-label={t('ui.legend')}>
      {series.map((s, i) => (
        <li key={s.key} className={styles.legendItem}>
          <svg width="24" height="10" aria-hidden="true" focusable="false">
            <rect width="24" height="10" rx="2" fill={fillFor(uid, i)} />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

function Frame({
  summary,
  children,
  legend,
}: {
  summary: string;
  children: React.ReactNode;
  legend: React.ReactNode;
}) {
  return (
    <figure className={styles.figure}>
      {children}
      {legend}
      <figcaption className="ui-sr-only">{summary}</figcaption>
    </figure>
  );
}

const tooltipProps = (formatValue?: (v: number) => string) => ({
  contentStyle: {
    background: '#fffefa',
    border: '1px solid #dedad0',
    borderRadius: 6,
    boxShadow: '0 8px 24px rgb(37 37 31 / 12%)',
    fontSize: 12,
  },
  cursor: { stroke: '#c9c4b6' },
  formatter: (v: unknown) => (formatValue ? formatValue(Number(v)) : String(v)),
});

const INITIAL = { width: 640, height: 240 };

export function BarChart(props: Props) {
  const { data, xKey, series, height = 240, formatValue } = props;
  const summary = useSummary(props);
  const uid = useId();
  return (
    <Frame summary={summary} legend={<Legend series={series} uid={uid} />}>
      <Patterns uid={uid} count={series.length} />
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={height} initialDimension={INITIAL}>
          <RBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="#dedad0" />
            <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: '#dedad0' }} />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={formatValue}
            />
            <Tooltip {...tooltipProps(formatValue)} cursor={{ fill: 'rgb(37 37 31 / 5%)' }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={fillFor(uid, i)}
                stroke={COLORS[i % COLORS.length]}
                radius={[3, 3, 0, 0]}
                maxBarSize={32}
                isAnimationActive={false}
              />
            ))}
          </RBarChart>
        </ResponsiveContainer>
      </div>
    </Frame>
  );
}
