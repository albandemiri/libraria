import * as Popover from '@radix-ui/react-popover';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type DateRange, type PresetId, presetRange } from '../lib/periods';
import { Button, IconButton } from './Button';
import styles from './Filters.module.css';
import { CrossIcon, SearchIcon } from './icons';

export function FilterBar({ children, label }: { children: ReactNode; label?: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: role=group labels a set of controls without a fieldset's layout quirks
    <div className={styles.bar} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name. */
  label: string;
  placeholder?: string;
  maxLength?: number;
}) {
  const { t } = useTranslation();
  return (
    <div className={`${styles.search} ${styles.grow}`}>
      <span className={styles.searchIcon} aria-hidden="true">
        <SearchIcon />
      </span>
      <input
        type="search"
        className={styles.searchInput}
        value={value}
        placeholder={placeholder ?? label}
        aria-label={label}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <IconButton
          label={t('ui.clearSearch')}
          size="sm"
          className={styles.clear}
          onClick={() => onChange('')}
        >
          <CrossIcon />
        </IconButton>
      )}
    </div>
  );
}

export type Option = { value: string; label: string };

/** A native select: fully accessible and keyboard-friendly, restyled to match. */
export function Select({
  value,
  onChange,
  options,
  label,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  'aria-required': required,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  /** Accessible name, unless a surrounding Field's label names it through `id`. */
  label: string;
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}) {
  return (
    <span className={styles.selectWrap}>
      <select
        id={id}
        className={styles.select}
        value={value}
        aria-label={id ? undefined : label}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-required={required}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function SegmentedControl({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  label: string;
}) {
  return (
    <ToggleGroup.Root
      type="single"
      className={styles.segmented}
      value={value}
      aria-label={label}
      // A segmented control always has one selection; ignore the "deselect" event.
      onValueChange={(next) => next && onChange(next)}
    >
      {options.map((o) => (
        <ToggleGroup.Item key={o.value} value={o.value} className={styles.segment}>
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}

export function DateRangePicker({
  value,
  onChange,
  presets,
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  presets: PresetId[];
}) {
  const { t } = useTranslation();
  const today = new Date();
  const matches = (id: PresetId) => {
    const r = presetRange(id, today);
    return r.from === value.from && r.to === value.to;
  };
  const isPreset = presets.some(matches);
  const setRange = (patch: Partial<DateRange>) => onChange({ ...value, ...patch });
  return (
    <fieldset className={styles.range} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="ui-sr-only">{t('period.label')}</legend>
      <div className={styles.segmented}>
        {presets.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.segment}
            data-state={matches(id) ? 'on' : 'off'}
            aria-pressed={matches(id)}
            onClick={() => onChange(presetRange(id, new Date()))}
          >
            {t(`period.${id}`)}
          </button>
        ))}
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={styles.segment}
              data-state={isPreset ? 'off' : 'on'}
              aria-pressed={!isPreset}
            >
              {t('period.custom')}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content className={styles.popover} align="end" sideOffset={6}>
              <label className={styles.dateField}>
                {t('period.from')}
                <input
                  className={styles.dateInput}
                  type="date"
                  value={value.from}
                  onChange={(e) => e.target.value && setRange({ from: e.target.value })}
                />
              </label>
              <label className={styles.dateField}>
                {t('period.to')}
                <input
                  className={styles.dateInput}
                  type="date"
                  value={value.to}
                  onChange={(e) => e.target.value && setRange({ to: e.target.value })}
                />
              </label>
              <Popover.Close asChild>
                <Button variant="primary" size="sm">
                  {t('ui.done')}
                </Button>
              </Popover.Close>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </fieldset>
  );
}
