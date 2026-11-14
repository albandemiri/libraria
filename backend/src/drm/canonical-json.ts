/**
 * Deterministic JSON: object keys sorted recursively (by UTF-16 code unit),
 * no whitespace. Used as the exact byte string a licence signature covers.
 *
 * Only null, booleans, finite numbers, strings, arrays and plain objects are
 * accepted; anything else (Date, NaN, Infinity, bigint, class instances...)
 * throws so that the signed bytes always match the JSON that goes on the wire.
 * `undefined` object members are skipped, exactly as JSON.stringify does.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError('canonicalJson: only plain objects are supported');
      }
      const source = value as Record<string, unknown>;
      const members = Object.keys(source)
        .filter((key) => source[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`);
      return `{${members.join(',')}}`;
    }
    default:
      throw new TypeError(`canonicalJson: unsupported value of type ${typeof value}`);
  }
}
