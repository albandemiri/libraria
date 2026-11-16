/** A same-site path: one leading slash, not protocol-relative, no backslash, no control characters. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) {
    return '/';
  }
  return value;
}
