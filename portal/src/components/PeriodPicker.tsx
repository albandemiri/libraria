import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type DateRange, type PresetId, presetRange } from '../lib/periods';

export type PeriodState = { preset: PresetId | 'custom'; range: DateRange };

const PRESETS: PresetId[] = ['this_month', 'last_month', 'last_90_days', 'this_year'];

export function usePeriod(initial: PresetId = 'this_month') {
  return useState<PeriodState>(() => ({
    preset: initial,
    range: presetRange(initial, new Date()),
  }));
}

type Props = { value: PeriodState; onChange(next: PeriodState): void };

export default function PeriodPicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const setRange = (patch: Partial<DateRange>) => {
    const range = { ...value.range, ...patch };
    onChange({ preset: 'custom', range });
  };
  return (
    <fieldset className="period-picker">
      <legend className="sr-only">{t('period.label')}</legend>
      {PRESETS.map((id) => (
        <button
          key={id}
          type="button"
          className="chip"
          aria-pressed={value.preset === id}
          onClick={() => onChange({ preset: id, range: presetRange(id, new Date()) })}
        >
          {t(`period.${id}`)}
        </button>
      ))}
      <button
        type="button"
        className="chip"
        aria-pressed={value.preset === 'custom'}
        onClick={() => onChange({ ...value, preset: 'custom' })}
      >
        {t('period.custom')}
      </button>
      {value.preset === 'custom' && (
        <>
          <label className="inline-field">
            <span>{t('period.from')}</span>
            <input
              type="date"
              value={value.range.from}
              onChange={(e) => e.target.value && setRange({ from: e.target.value })}
            />
          </label>
          <label className="inline-field">
            <span>{t('period.to')}</span>
            <input
              type="date"
              value={value.range.to}
              onChange={(e) => e.target.value && setRange({ to: e.target.value })}
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
