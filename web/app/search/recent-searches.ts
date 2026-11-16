const KEY = 'libraria.recentSearches';
const MAX = 5;

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function save(items: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    // Storage is unavailable (private mode, blocked): recent searches are a convenience only.
  }
}

/** Per-browser recent searches, newest first. Every access is guarded; failures read as empty. */
export const recentSearches = {
  read(): string[] {
    return load().slice(0, MAX);
  },
  add(query: string): void {
    const q = query.trim();
    if (!q) return;
    const rest = load().filter((item) => item.toLowerCase() !== q.toLowerCase());
    save([q, ...rest].slice(0, MAX));
  },
  remove(query: string): void {
    save(load().filter((item) => item !== query));
  },
};
