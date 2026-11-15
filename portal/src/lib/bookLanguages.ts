/**
 * Book languages offered at launch. Libraria is an Albanian ebook marketplace,
 * so Albanian comes first and is the default. Must match BOOK_LANGUAGES in
 * backend/src/routes/publisher.ts.
 */
export const BOOK_LANGUAGES = ['sq', 'en'] as const;
export const DEFAULT_BOOK_LANGUAGE = 'sq';

/** The dropdown's options; keeps an older book's language selectable so editing never changes it silently. */
export function bookLanguageOptions(current: string): string[] {
  const base: string[] = [...BOOK_LANGUAGES];
  return current && !base.includes(current) ? [...base, current] : base;
}
