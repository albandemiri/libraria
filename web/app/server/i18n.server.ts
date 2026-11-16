import { DEFAULT_LANGUAGE, isLang, type Lang } from '../i18n';

export const LANGUAGE_COOKIE = 'libraria_lang';

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch {
      // A malformed value (say `%E0%A4%A`) is no language: fall through to Accept-Language.
      return undefined;
    }
  }
  return undefined;
}

/** Accept-Language ranges ordered by quality (stable for equal weights). */
function acceptedLanguages(header: string | null): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((entry, index) => {
      const [range, ...params] = entry.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const quality = q ? Number(q.slice(2)) : 1;
      return {
        range: range.trim().toLowerCase(),
        quality: Number.isNaN(quality) ? 0 : quality,
        index,
      };
    })
    .filter((entry) => entry.range && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((entry) => entry.range);
}

/** The `libraria_lang` cookie, then Accept-Language (sq* → sq, en* → en), then sq. */
export function detectLanguage(request: Request): Lang {
  const cookie = readCookie(request.headers.get('cookie'), LANGUAGE_COOKIE);
  if (isLang(cookie)) return cookie;

  for (const range of acceptedLanguages(request.headers.get('accept-language'))) {
    const primary = range.split('-')[0];
    if (isLang(primary)) return primary;
  }
  return DEFAULT_LANGUAGE;
}
