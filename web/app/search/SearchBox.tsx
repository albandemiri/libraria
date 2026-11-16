import {
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useFetcher, useNavigate } from 'react-router';
import { VisuallyHidden } from '../ui/VisuallyHidden';
import { BookCover } from '../books/BookCover';
import { useLang } from '../books/useLang';
import { bookHref, formatPrice } from '../lib/format';
import type { Suggestions } from '../lib/types';
import { recentSearches } from './recent-searches';
import styles from './SearchBox.module.css';

const MIN_CHARS = 2;
const MAX_CHARS = 100;
const DEBOUNCE_MS = 200;

type Option = {
  id: string;
  kind: 'title' | 'author' | 'publisher' | 'recent' | 'all';
  href: string;
  label: string;
};

/** Lower-cased, diacritics removed; each folded character remembers the original span it came from. */
function fold(text: string): { folded: string; spans: Array<[number, number]> } {
  let folded = '';
  const spans: Array<[number, number]> = [];
  let at = 0;
  for (const ch of text) {
    const plain = ch
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase();
    for (const _ of plain) spans.push([at, at + ch.length]);
    folded += plain;
    at += ch.length;
  }
  return { folded, spans };
}

/** Wraps the first match of `query` in <mark>; matching ignores case and diacritics, output keeps the original text. */
function Highlight({ text, query }: { text: string; query: string }) {
  const needle = fold(query.trim()).folded;
  if (!needle) return text;
  const { folded, spans } = fold(text);
  const start = folded.indexOf(needle);
  if (start < 0) return text;
  const from = spans[start]?.[0] ?? 0;
  const to = spans[start + needle.length - 1]?.[1] ?? text.length;
  return (
    <>
      {text.slice(0, from)}
      <mark className={styles.mark}>{text.slice(from, to)}</mark>
      {text.slice(to)}
    </>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** The header search: an ARIA 1.2 combobox with grouped suggestions. Works without JavaScript as a plain GET form. */
export function SearchBox() {
  const { t } = useTranslation();
  const lang = useLang();
  const navigate = useNavigate();
  const fetcher = useFetcher<Suggestions>();
  const uid = useId();
  const listId = `${uid}-list`;
  const hintId = `${uid}-hint`;
  const rootRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [recents, setRecents] = useState<string[]>([]);

  const trimmed = query.trim();
  const searching = trimmed.length >= MIN_CHARS;

  // Debounced fetch. The fetcher cancels a superseded load, so only the latest query's data arrives.
  const load = fetcher.load;
  const requested = useRef('');
  const [dataFor, setDataFor] = useState('');
  useEffect(() => {
    if (trimmed.length < MIN_CHARS) return;
    const timer = setTimeout(() => {
      requested.current = trimmed;
      load(`/kerko/sugjerime?q=${encodeURIComponent(trimmed.slice(0, MAX_CHARS))}`);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, load]);

  // The loaded data belongs to the latest requested query; it is fresh only while that is still the query.
  const loaded = fetcher.data;
  const idle = fetcher.state === 'idle';
  useEffect(() => {
    if (idle && loaded) setDataFor(requested.current);
  }, [idle, loaded]);
  const fresh = searching && dataFor === trimmed ? loaded : undefined;
  // While the next query loads, the last shown results stay (highlighted for the current query),
  // so the list does not close and reopen between keystrokes. Dropping under 2 characters
  // forgets them: results never reappear for a query that has not loaded yet.
  const [kept, setKept] = useState<Suggestions | undefined>(undefined);
  useEffect(() => {
    if (!searching) setKept(undefined);
    else if (fresh) setKept(fresh);
  }, [searching, fresh]);
  const data = searching ? (fresh ?? kept) : undefined;
  const showRecents = focused && !searching && recents.length > 0;

  const options: Option[] = [];
  if (searching && data) {
    for (const book of data.titles) {
      options.push({
        id: `title-${book.id}`,
        kind: 'title',
        href: bookHref(book),
        label: book.title,
      });
    }
    for (const author of data.authors) {
      options.push({
        id: `author-${author.name}`,
        kind: 'author',
        href: `/kerko?q=${encodeURIComponent(author.name)}`,
        label: author.name,
      });
    }
    for (const publisher of data.publishers) {
      options.push({
        id: `publisher-${publisher.id}`,
        kind: 'publisher',
        href: `/botues/${encodeURIComponent(publisher.id)}`,
        label: publisher.name,
      });
    }
    options.push({
      id: 'all',
      kind: 'all',
      href: `/kerko?q=${encodeURIComponent(trimmed)}`,
      label: t('search.all', { q: trimmed }),
    });
  } else if (showRecents) {
    for (const q of recents) {
      options.push({
        id: `recent-${q}`,
        kind: 'recent',
        href: `/kerko?q=${encodeURIComponent(q)}`,
        label: q,
      });
    }
  }

  const open = focused && !dismissed && options.length > 0;
  const optionId = (index: number) => `${uid}-opt-${index}`;
  const optionKey = options.map((o) => o.id).join('|');

  // A new set of options starts with nothing active.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the options change
  useEffect(() => setActive(-1), [optionKey]);

  const go = (href: string, remember: string) => {
    recentSearches.add(remember);
    setDismissed(true);
    setActive(-1);
    navigate(href);
  };

  const choose = (option: Option) => {
    if (option.kind === 'recent') return go(option.href, option.label);
    if (option.kind === 'all') return go(option.href, trimmed);
    go(option.href, trimmed || option.label);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const option = open ? options[active] : undefined;
    if (option) return choose(option);
    if (trimmed) go(`/kerko?q=${encodeURIComponent(trimmed)}`, trimmed);
  };

  const removeRecent = (q: string) => {
    recentSearches.remove(q);
    setRecents(recentSearches.read());
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = options.length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (count === 0) return;
        event.preventDefault();
        if (!open) {
          setDismissed(false);
          return;
        }
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current) =>
          current < 0 ? (step === 1 ? 0 : count - 1) : (current + step + count) % count,
        );
        return;
      }
      case 'Escape':
        if (open) {
          event.preventDefault();
          setDismissed(true);
          setActive(-1);
        }
        return;
      case 'Delete': {
        const option = open ? options[active] : undefined;
        if (option?.kind === 'recent') {
          event.preventDefault();
          removeRecent(option.label);
        }
        return;
      }
    }
  };

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setDismissed(false);
  };

  const onFocus = () => {
    setRecents(recentSearches.read());
    setFocused(true);
    setDismissed(false);
  };

  const onBlur = (event: FocusEvent) => {
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  const renderOption = (option: Option, index: number) => {
    const book = data?.titles.find((b) => `title-${b.id}` === option.id);
    const author = data?.authors.find((a) => `author-${a.name}` === option.id);
    const publisher = data?.publishers.find((p) => `publisher-${p.id}` === option.id);
    const genre = (g: string) => t(`genres.${g}`, { defaultValue: g });
    let body: React.ReactNode;
    if (book) {
      body = (
        <>
          <span className={styles.thumb}>
            <BookCover book={book} size="thumb" alt="" />
          </span>
          <span className={styles.text}>
            <span className={styles.title}>
              <Highlight text={book.title} query={trimmed} />
            </span>
            <small className={styles.sub}>
              {book.author} · {genre(book.genre)}
            </small>
          </span>
          <small className={styles.aside}>
            {formatPrice(book.price.amountCents, book.price.currency, lang)}
          </small>
        </>
      );
    } else if (author) {
      body = (
        <>
          <span className={styles.mono} aria-hidden="true">
            {initials(author.name)}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>
              <Highlight text={author.name} query={trimmed} />
            </span>
            <small className={styles.sub}>
              {t('masthead.books', { count: author.bookCount })} · {genre(author.mainGenre)}
            </small>
          </span>
        </>
      );
    } else if (publisher) {
      body = (
        <>
          <span className={styles.mono} aria-hidden="true">
            {initials(publisher.name)}
          </span>
          <span className={styles.text}>
            <span className={styles.title}>
              <Highlight text={publisher.name} query={trimmed} />
            </span>
            <small className={styles.sub}>
              {t('masthead.books', { count: publisher.bookCount })}
            </small>
          </span>
        </>
      );
    } else if (option.kind === 'recent') {
      body = (
        <>
          <span className={styles.mono} aria-hidden="true">
            ↺
          </span>
          <span className={styles.text}>{option.label}</span>
        </>
      );
    } else {
      body = (
        <>
          <span className={styles.allLabel}>{option.label}</span>
          <span className={styles.hint} aria-hidden="true">
            {t('search.enter')}
          </span>
        </>
      );
    }
    const row = (
      // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection goes through the combobox input
      <div
        id={optionId(index)}
        role="option"
        aria-selected={index === active}
        tabIndex={-1}
        style={option.kind === 'recent' ? { gridRow: index + 2 } : undefined}
        className={`${styles.option} ${option.kind === 'all' ? styles.all : ''} ${option.kind === 'recent' ? styles.recent : ''} ${index === active ? styles.active : ''}`}
        onClick={() => choose(option)}
      >
        {body}
      </div>
    );
    return row;
  };

  const group = (kind: Option['kind'], labelKey: string) => {
    const items = options.map((o, i) => [o, i] as const).filter(([o]) => o.kind === kind);
    if (items.length === 0) return null;
    return (
      // biome-ignore lint/a11y/useSemanticElements: a fieldset is a form control; this labels a set of listbox options
      <div role="group" aria-labelledby={`${uid}-g-${kind}`} key={kind}>
        <div id={`${uid}-g-${kind}`} className={styles.heading} role="presentation">
          {t(labelKey)}
        </div>
        {items.map(([o, i]) => renderOption(o, i))}
      </div>
    );
  };

  const allIndex = options.findIndex((o) => o.kind === 'all');

  return (
    <form
      ref={rootRef}
      action="/kerko"
      method="get"
      className={styles.root}
      onSubmit={onSubmit}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className={`${styles.field} ${focused ? styles.focused : ''}`}>
        <svg
          className={styles.icon}
          viewBox="0 0 16 16"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M10.5 10.5 14 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
        <input
          ref={inputRef}
          name="q"
          type="text"
          role="combobox"
          className={styles.input}
          value={query}
          maxLength={MAX_CHARS}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-describedby={open && showRecents ? hintId : undefined}
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && showRecents && <VisuallyHidden id={hintId}>{t('search.removeHint')}</VisuallyHidden>}
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: keeps focus in the input while an option is clicked
        <div
          className={`${styles.popover} ${showRecents && !searching ? styles.recentsGrid : ''}`}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div id={listId} role="listbox" aria-label={t('search.label')}>
            {searching ? (
              <>
                {group('title', 'search.titles')}
                {group('author', 'search.authors')}
                {group('publisher', 'search.publishers')}
                {allIndex >= 0 && options[allIndex] && renderOption(options[allIndex], allIndex)}
              </>
            ) : (
              group('recent', 'search.recent')
            )}
          </div>
          {showRecents && !searching && (
            // Buttons cannot be listbox children, so they follow it and share the popover grid with the rows.
            <div className={styles.removers}>
              {options.map((o, index) => (
                <button
                  key={o.id}
                  type="button"
                  className={styles.remove}
                  style={{ gridRow: index + 2 }}
                  aria-label={t('search.remove', { q: o.label })}
                  onClick={() => removeRecent(o.label)}
                >
                  <span aria-hidden="true">✕</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </form>
  );
}
