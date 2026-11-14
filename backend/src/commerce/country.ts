/** Normalises a provider-reported country to an upper-case ISO alpha-2 code, or null. */
export function normalizeCountry(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}
