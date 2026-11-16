import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Form, useFetcher, useNavigate } from 'react-router';
import { useLang } from '../books/useLang';
import { Button, Sheet } from '../ui';
import type { ExploreData } from './ExplorePage';
import styles from './FilterSheet.module.css';
import { languageLabel, priceLabel, sinceLabel } from './labels';
import {
  basePath,
  clearFilters,
  type ExploreState,
  exploreHref,
  PRICE_STEPS,
  SINCE,
  toSearchParams,
} from './params';
import { toggled } from './useExploreDraft';

const SHEET_FORM_ID = 'explore-sheet';

type PillProps = {
  type: 'checkbox' | 'radio';
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
};

/** A tap-to-select option: a real checkbox or radio drawn as a chip. */
function Pill({ type, name, checked, onChange, children }: PillProps) {
  return (
    <label className={styles.pill}>
      <input
        type={type}
        name={name}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={styles.input}
      />
      {children}
    </label>
  );
}

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>{legend}</legend>
      <div className={styles.pills}>{children}</div>
    </fieldset>
  );
}

/** The scope and filters the count route needs, as page query parameters. */
const countQuery = (draft: ExploreState) => toSearchParams({ ...draft, page: 1 }, 'search');

type Props = { data: ExploreData; open: boolean; onOpenChange: (open: boolean) => void };

/**
 * The phone filters: a bottom sheet of tap-to-select options. Choices stay local until
 * "Shfaq N libra"; N is re-counted through /eksploro/numero as they change.
 */
export function FilterSheet({ data, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const fetcher = useFetcher<{ total: number | null }>();
  const { mode, state, facets } = data;
  const [draft, setDraft] = useState(state);
  const [wasOpen, setWasOpen] = useState(open);
  // The query the fetcher was last asked about, so a count is only shown for the current draft.
  const [requested, setRequested] = useState<string | null>(null);
  // Every opening starts from the page's current filters.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(state);
  }

  const update = (next: ExploreState) => {
    setDraft(next);
    const query = countQuery(next).toString();
    setRequested(query);
    fetcher.load(`/eksploro/numero?${query}`);
  };
  const change = (patch: Partial<ExploreState>) => update({ ...draft, ...patch });

  const draftQuery = countQuery(draft).toString();
  const fetched =
    fetcher.state === 'idle' && requested === draftQuery ? (fetcher.data?.total ?? null) : null;
  // Unknown (in flight, or the count failed): no number rather than a stale one.
  const total = draftQuery === countQuery(state).toString() ? facets.total : fetched;

  const languages = facets.languages.map((l) => l.language);
  if (draft.language && !languages.includes(draft.language)) languages.push(draft.language);

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('explore.filters.title')}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" onClick={() => update(clearFilters(draft, mode))}>
            {t('explore.filters.clear')}
          </Button>
          <Button
            type="submit"
            form={SHEET_FORM_ID}
            size="lg"
            className={styles.show}
            aria-live="polite"
          >
            {total === null
              ? t('explore.filters.showAny')
              : t('explore.filters.show', { count: total })}
          </Button>
        </div>
      }
    >
      <Form
        id={SHEET_FORM_ID}
        method="get"
        action={basePath(mode, state)}
        onSubmit={(event) => {
          event.preventDefault();
          onOpenChange(false);
          navigate(exploreHref(mode, { ...draft, page: 1 }));
        }}
      >
        {mode !== 'publisher' && facets.publishers.length > 0 ? (
          <Group legend={t('explore.filters.publisher')}>
            {facets.publishers.map((p) => (
              <Pill
                key={p.id}
                type="checkbox"
                name="publisherId"
                checked={draft.publisherIds.includes(p.id)}
                onChange={(on) => change({ publisherIds: toggled(draft.publisherIds, p.id, on) })}
              >
                {p.name}
              </Pill>
            ))}
          </Group>
        ) : null}

        <Group legend={t('explore.filters.language')}>
          <Pill
            type="radio"
            name="language"
            checked={!draft.language}
            onChange={() => change({ language: undefined })}
          >
            {t('explore.filters.allLanguages')}
          </Pill>
          {languages.map((code) => (
            <Pill
              key={code}
              type="radio"
              name="language"
              checked={draft.language === code}
              onChange={() => change({ language: code })}
            >
              {languageLabel(t, code)}
            </Pill>
          ))}
        </Group>

        <Group legend={t('explore.filters.price')}>
          {PRICE_STEPS.map((cents) => (
            <Pill
              key={cents}
              type="radio"
              name="maxPrice"
              checked={draft.maxPrice === cents}
              onChange={() => change({ maxPrice: cents })}
            >
              {priceLabel(t, cents, lang)}
            </Pill>
          ))}
          <Pill
            type="radio"
            name="maxPrice"
            checked={draft.maxPrice === undefined}
            onChange={() => change({ maxPrice: undefined })}
          >
            {t('explore.filters.anyPrice')}
          </Pill>
        </Group>

        <Group legend={t('explore.filters.published')}>
          {SINCE.map((since) => (
            <Pill
              key={since}
              type="radio"
              name="since"
              checked={draft.since === since}
              onChange={() => change({ since })}
            >
              {sinceLabel(t, since, true)}
            </Pill>
          ))}
          <Pill
            type="radio"
            name="since"
            checked={!draft.since}
            onChange={() => change({ since: undefined })}
          >
            {t('explore.filters.anyTime')}
          </Pill>
        </Group>

        {data.signedIn ? (
          <Group legend={t('explore.filters.hideOwned')}>
            <Pill
              type="checkbox"
              name="hideOwned"
              checked={draft.hideOwned}
              onChange={(on) => change({ hideOwned: on })}
            >
              {t('explore.filters.hideOwned')}
            </Pill>
          </Group>
        ) : null}
      </Form>
    </Sheet>
  );
}
