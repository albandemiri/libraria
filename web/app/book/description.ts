/** The pull quote is cut at a word near this many characters. */
const LEDE_MAX = 240;

/** The description split into paragraphs on blank lines. */
export function paragraphs(description: string | null): string[] {
  if (!description) return [];
  return description
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Splits the description between the hero's pull quote and "Rreth librit", so no text is shown
 * twice: the quote is the first paragraph and the synopsis the rest. A first paragraph too long for
 * the quote is shown cut there and in full in the synopsis.
 */
export function splitDescription(description: string | null): {
  lede: string | null;
  body: string[];
} {
  const [first, ...rest] = paragraphs(description);
  if (!first) return { lede: null, body: [] };
  if (first.length <= LEDE_MAX) return { lede: first, body: rest };
  const cut = first.slice(0, LEDE_MAX);
  const space = cut.lastIndexOf(' ');
  return { lede: `${cut.slice(0, space > 0 ? space : LEDE_MAX)}…`, body: [first, ...rest] };
}
