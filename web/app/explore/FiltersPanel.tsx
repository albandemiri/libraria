import { useTranslation } from 'react-i18next';
import { Form } from 'react-router';
import { useLang } from '../books/useLang';
import { Button, Checkbox, Radio, Select } from '../ui';
import type { ExploreData } from './ExplorePage';
import styles from './FiltersPanel.module.css';
import { languageLabel, priceLabel, sinceLabel } from './labels';
import { basePath, type ExploreState, FILTERS_FORM_ID, PRICE_STEPS, SINCE } from './params';
import { type ChangeState, toggled } from './useExploreDraft';

function Count({ n }: { n: number }) {
  return <span className={styles.count}>{n}</span>;
}

/**
 * The desktop sidebar. Each change goes straight to the new URL (page 1). It is also a real GET
 * form, so without JavaScript the "Apliko" button in <noscript> submits the same choices.
 */
type Props = { data: ExploreData; draft: ExploreState; change: ChangeState };

export function FiltersPanel({ data, draft, change }: Props) {
  const { t } = useTranslation();
  const lang = useLang();
  const { mode, state, facets } = data;

  const publishers = [...facets.publishers];
  for (const id of state.publisherIds) {
    if (mode !== 'publisher' && !publishers.some((p) => p.id === id)) {
      publishers.push({ id, name: t('explore.chips.publisher'), bookCount: 0 });
    }
  }
  const languages = [...facets.languages];
  if (state.language && !languages.some((l) => l.language === state.language)) {
    languages.push({ language: state.language, bookCount: 0 });
  }
  const languageTotal = facets.languages.reduce((sum, l) => sum + l.bookCount, 0);
  const prices: number[] = [...PRICE_STEPS];
  if (state.maxPrice !== undefined && !prices.includes(state.maxPrice)) {
    prices.push(state.maxPrice);
    prices.sort((a, b) => a - b);
  }

  return (
    <Form id={FILTERS_FORM_ID} method="get" action={basePath(mode, state)} className={styles.panel}>
      {/* The page's scope and settings that are not filters ride along. */}
      {state.q ? <input type="hidden" name="q" value={state.q} /> : null}
      {state.genre && (mode === 'search' || mode === 'publisher') ? (
        <input type="hidden" name="genre" value={state.genre} />
      ) : null}
      {state.view !== 'grid' ? <input type="hidden" name="view" value={state.view} /> : null}

      {mode !== 'publisher' && publishers.length > 0 ? (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('explore.filters.publisher')}</legend>
          {publishers.map((p) => (
            <Checkbox
              key={p.id}
              className={styles.option}
              name="publisherId"
              value={p.id}
              checked={draft.publisherIds.includes(p.id)}
              onChange={(e) =>
                change({ publisherIds: toggled(draft.publisherIds, p.id, e.target.checked) })
              }
              label={
                <>
                  <span>{p.name}</span>
                  <Count n={p.bookCount} />
                </>
              }
            />
          ))}
        </fieldset>
      ) : null}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('explore.filters.language')}</legend>
        <Radio
          className={styles.option}
          name="language"
          value=""
          checked={!draft.language}
          onChange={() => change({ language: undefined })}
          label={
            <>
              <span>{t('explore.filters.allLanguages')}</span>
              <Count n={languageTotal} />
            </>
          }
        />
        {languages.map((l) => (
          <Radio
            key={l.language}
            className={styles.option}
            name="language"
            value={l.language}
            checked={draft.language === l.language}
            onChange={() => change({ language: l.language })}
            label={
              <>
                <span>{languageLabel(t, l.language)}</span>
                <Count n={l.bookCount} />
              </>
            }
          />
        ))}
      </fieldset>

      <div className={styles.group}>
        <span className={styles.legend} aria-hidden="true">
          {t('explore.filters.price')}
        </span>
        <Select
          label={t('explore.filters.price')}
          hideLabel
          name="maxPrice"
          value={draft.maxPrice === undefined ? '' : String(draft.maxPrice)}
          onChange={(e) =>
            change({ maxPrice: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          className={styles.select}
        >
          <option value="">{t('explore.filters.anyPrice')}</option>
          {prices.map((cents) => (
            <option key={cents} value={cents}>
              {priceLabel(t, cents, lang)}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{t('explore.filters.published')}</legend>
        {SINCE.map((since) => (
          <Radio
            key={since}
            className={styles.option}
            name="since"
            value={since}
            checked={draft.since === since}
            onChange={() => change({ since })}
            label={sinceLabel(t, since)}
          />
        ))}
        <Radio
          className={styles.option}
          name="since"
          value=""
          checked={!draft.since}
          onChange={() => change({ since: undefined })}
          label={t('explore.filters.anyTime')}
        />
      </fieldset>

      {data.signedIn ? (
        <label className={styles.switch}>
          <input
            type="checkbox"
            // biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox already exposes its checked state
            role="switch"
            name="hideOwned"
            value="true"
            checked={draft.hideOwned}
            onChange={(e) => change({ hideOwned: e.target.checked })}
            className={styles.switchInput}
          />
          <span className={styles.track} aria-hidden="true" />
          <span>{t('explore.filters.hideOwned')}</span>
        </label>
      ) : null}

      <noscript>
        <div className={styles.apply}>
          <Button type="submit" variant="secondary">
            {t('explore.filters.apply')}
          </Button>
        </div>
      </noscript>
    </Form>
  );
}
