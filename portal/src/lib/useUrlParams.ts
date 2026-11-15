import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export type UrlPatch = Record<string, string | undefined>;

/**
 * The URL search params and a patch-style updater: each key is set, or removed when its value is
 * undefined or empty. Pass `replace` to rewrite the current history entry instead of adding one.
 */
export function useUrlParams() {
  const [params, setParams] = useSearchParams();
  const update = useCallback(
    (patch: UrlPatch, replace = false) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '') next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace },
      ),
    [setParams],
  );
  return { params, update };
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * A search box backed by the `q` URL param. Typing reaches the URL (and so the server query)
 * after a short pause, resetting the page; the URL wins when it changes under us (Back, a link).
 * `flush` applies pending text at once.
 */
export function useDebouncedUrlSearch(
  q: string,
  update: (patch: UrlPatch, replace?: boolean) => void,
) {
  const [text, setText] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  if (seenQ !== q) {
    setSeenQ(q);
    setText(q);
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: only typing should schedule an update; a URL change must not write the old text back
  useEffect(() => {
    if (text === q) return;
    const id = setTimeout(() => update({ q: text, page: undefined }, true), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text]);
  const flush = () => {
    if (text !== q) update({ q: text, page: undefined }, true);
  };
  return { text, setText, flush };
}
