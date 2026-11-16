// Pure formatting helpers shared by the server and the client. The language is always passed in.

export type FormatLang = 'sq' | 'en';

const LOCALES: Record<FormatLang, string> = { sq: 'sq-AL', en: 'en-US' };

/** `5,99 €` in Albanian, `€5.99` in English. */
export function formatPrice(cents: number, currency: string, lang: FormatLang): string {
  // Intl's non-breaking space is kept so the amount never wraps before the currency sign.
  return new Intl.NumberFormat(LOCALES[lang], { style: 'currency', currency }).format(cents / 100);
}

/** `16 nëntor 2026` (day) or `nëntor 2026` (month). Dates are read in UTC so the day never shifts. */
export function formatDate(iso: string, lang: FormatLang, style: 'day' | 'month'): string {
  return new Intl.DateTimeFormat(lang, {
    ...(style === 'day' ? { day: 'numeric' } : {}),
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/** `9780000000095` becomes `978-0-00-000009-5`; anything that is not 13 digits is returned as is. */
export function formatIsbn13(isbn: string): string {
  const m = /^(\d{3})(\d)(\d{2})(\d{6})(\d)$/.exec(isbn);
  return m ? m.slice(1).join('-') : isbn;
}

export function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function bookHref(book: { id: string; title: string }): string {
  const slug = slugify(book.title);
  return slug ? `/libri/${book.id}/${slug}` : `/libri/${book.id}`;
}

function coverPath(id: string, v: string | null, size?: 'thumb'): string {
  const params = new URLSearchParams();
  if (v) params.set('v', v);
  if (size) params.set('size', size);
  const query = params.toString();
  return `/kopertina/${encodeURIComponent(id)}${query ? `?${query}` : ''}`;
}

/** The cover proxy URL for a book, keeping the API's `v` cache-buster; null when it has no cover. */
export function coverSrc(
  book: { id: string; coverImageUrl: string | null },
  size?: 'thumb',
): string | null {
  if (!book.coverImageUrl) return null;
  const v = new URL(book.coverImageUrl, 'http://api.invalid').searchParams.get('v');
  return coverPath(book.id, v, size);
}

/** For callers that only have an id (genre tiles); no cache-buster. */
export function coverSrcById(id: string, size?: 'thumb'): string {
  return coverPath(id, null, size);
}
