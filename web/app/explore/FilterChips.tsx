import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useLang } from '../books/useLang';
import { chipClasses } from '../ui';
import type { ExploreData } from './ExplorePage';
import styles from './FilterChips.module.css';
import { languageLabel, priceLabel, sinceLabel } from './labels';
import { clearFilters, type ExploreState, exploreHref } from './params';

type ChipItem = { key: string; label: string; without: ExploreState };

/** One removable chip per active filter (each a plain link), then "Pastro të gjitha". */
export function FilterChips({ data }: { data: ExploreData }) {
  const { t } = useTranslation();
  const lang = useLang();
  const { mode, state, facets } = data;
  const base = { ...state, page: 1 };
  const chips: ChipItem[] = [];

  if (state.genre && (mode === 'search' || mode === 'publisher')) {
    chips.push({
      key: 'genre',
      label: t(`genres.${state.genre}`, { defaultValue: state.genre }),
      without: { ...base, genre: undefined },
    });
  }
  if (mode !== 'publisher') {
    for (const id of state.publisherIds) {
      chips.push({
        key: `publisher-${id}`,
        label: facets.publishers.find((p) => p.id === id)?.name ?? t('explore.chips.publisher'),
        without: { ...base, publisherIds: state.publisherIds.filter((other) => other !== id) },
      });
    }
  }
  if (state.language) {
    chips.push({
      key: 'language',
      label: languageLabel(t, state.language),
      without: { ...base, language: undefined },
    });
  }
  if (state.maxPrice !== undefined) {
    chips.push({
      key: 'price',
      label: priceLabel(t, state.maxPrice, lang),
      without: { ...base, maxPrice: undefined },
    });
  }
  if (state.since) {
    chips.push({
      key: 'since',
      label: sinceLabel(t, state.since),
      without: { ...base, since: undefined },
    });
  }
  if (state.hideOwned) {
    chips.push({
      key: 'owned',
      label: t('explore.filters.hideOwned'),
      without: { ...base, hideOwned: false },
    });
  }

  if (chips.length === 0) return null;
  return (
    <ul className={styles.chips} aria-label={t('explore.chips.label')}>
      {chips.map((chip) => (
        <li key={chip.key} className={chipClasses.chip}>
          <span>{chip.label}</span>
          <Link
            className={chipClasses.remove}
            to={exploreHref(mode, chip.without)}
            preventScrollReset
            aria-label={t('explore.chips.remove', { label: chip.label })}
          >
            <span aria-hidden="true">✕</span>
          </Link>
        </li>
      ))}
      <li>
        <Link
          className={styles.clear}
          to={exploreHref(mode, clearFilters(state, mode))}
          preventScrollReset
        >
          {t('explore.chips.clearAll')}
        </Link>
      </li>
    </ul>
  );
}
