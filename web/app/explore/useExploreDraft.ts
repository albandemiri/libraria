import { useState } from 'react';
import { useNavigate } from 'react-router';
import { type ExploreMode, type ExploreState, exploreHref } from './params';

export type ChangeState = (patch: Partial<ExploreState>) => void;

/**
 * The page state as the controls show it. A change updates it at once and goes to the new URL
 * (page 1, scroll kept), so a second change made while the first is loading builds on it.
 * It resets whenever the loader's state changes (a chip link, back/forward).
 * Owned by the page and shared by the sidebar and the toolbar.
 */
export function useExploreDraft(mode: ExploreMode, state: ExploreState) {
  const navigate = useNavigate();
  const href = exploreHref(mode, state);
  const [draft, setDraft] = useState(state);
  const [syncedHref, setSyncedHref] = useState(href);
  if (syncedHref !== href) {
    setSyncedHref(href);
    setDraft(state);
  }
  const change: ChangeState = (patch) => {
    const next = { ...draft, ...patch, page: 1 };
    setDraft(next);
    navigate(exploreHref(mode, next), { preventScrollReset: true });
  };
  return { draft, change };
}

/** Adds or removes one value from a list. */
export function toggled(list: string[], value: string, on: boolean): string[] {
  return on ? [...new Set([...list, value])] : list.filter((item) => item !== value);
}
