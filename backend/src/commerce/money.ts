/**
 * Splits `total` integer cents across `weights` proportionally, so the parts
 * always sum exactly to `total` (largest-remainder method). Used to spread a
 * transaction-level provider fee across its line items.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error(`allocate: total must be a non-negative integer, got ${total}`);
  }

  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) {
    // Nothing to weight by (e.g. all free items): put it all on the first.
    return weights.map((_, index) => (index === 0 ? total : 0));
  }

  const exact = weights.map((weight) => (total * weight) / weightSum);
  const parts = exact.map(Math.floor);
  let remainder = total - parts.reduce((sum, part) => sum + part, 0);

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const { index } of byFraction) {
    if (remainder === 0) break;
    parts[index] += 1;
    remainder -= 1;
  }

  return parts;
}

/** Parses a provider amount given as a string of integer minor units. */
export function parseMinorUnits(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Error(`Not an integer minor-unit amount: ${JSON.stringify(value)}`);
}
