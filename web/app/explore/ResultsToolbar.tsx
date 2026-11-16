import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, Select } from '../ui';
import type { ExploreData } from './ExplorePage';
import { FilterChips } from './FilterChips';
import {
  activeFilterCount,
  type ExploreState,
  exploreHref,
  FILTERS_FORM_ID,
  SORTS,
  type Sort,
  type View,
} from './params';
import styles from './ResultsToolbar.module.css';
import type { ChangeState } from './useExploreDraft';

function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z" fill="currentColor" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2 3h12v2H2zM2 7h12v2H2zM2 11h12v2H2z" fill="currentColor" />
    </svg>
  );
}

type Props = {
  data: ExploreData;
  draft: ExploreState;
  change: ChangeState;
  onOpenFilters: () => void;
};

/** Chips, the sort select and the grid/list switch; on phones, the "Filtrat · N" button. */
export function ResultsToolbar({ data, draft, change, onOpenFilters }: Props) {
  const { t } = useTranslation();
  const { mode, state } = data;
  const active = activeFilterCount(state, mode);

  const viewLink = (view: View, label: string, icon: React.ReactNode) => (
    <Link
      className={styles.view}
      to={exploreHref(mode, { ...state, view })}
      preventScrollReset
      aria-label={label}
      aria-current={state.view === view ? 'true' : undefined}
    >
      {icon}
    </Link>
  );

  return (
    <div className={styles.toolbar}>
      <button
        type="button"
        className={styles.filters}
        aria-haspopup="dialog"
        onClick={onOpenFilters}
      >
        {active > 0 ? t('explore.filters.open', { count: active }) : t('explore.filters.title')}
      </button>
      <div className={styles.chips}>
        <FilterChips data={data} />
      </div>
      <div className={styles.controls}>
        <Select
          label={t('explore.toolbar.sort')}
          name="sort"
          form={FILTERS_FORM_ID}
          value={draft.sort}
          onChange={(event) => change({ sort: event.target.value as Sort })}
        >
          {SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(`explore.toolbar.sorts.${sort}`)}
            </option>
          ))}
        </Select>
        <noscript>
          <Button type="submit" form={FILTERS_FORM_ID} variant="secondary">
            {t('explore.filters.apply')}
          </Button>
        </noscript>
        <ul className={styles.views} aria-label={t('explore.toolbar.view')}>
          <li>{viewLink('grid', t('explore.toolbar.grid'), <GridIcon />)}</li>
          <li>{viewLink('list', t('explore.toolbar.list'), <ListIcon />)}</li>
        </ul>
      </div>
    </div>
  );
}
