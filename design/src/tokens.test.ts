import { mkdtempSync, readFileSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCss, writeIfChanged } from '../scripts/build-css.ts';
import { contrastRatio } from './contrast.ts';
import { tokens } from './tokens.ts';

const c = tokens.color;

describe('contrastRatio', () => {
  it('handles 3- and 6-digit hex and known values', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5);
  });
  it('throws on invalid input', () => {
    for (const bad of ['red', '#12', '#12345', '#1234567', '123456', '#ggg'])
      expect(() => contrastRatio(bad, '#fff')).toThrow();
  });
});

describe('token contrast', () => {
  it('text and textSecondary pass 4.5:1 on bg and surface', () => {
    for (const bg of [c.bg, c.surface])
      for (const fg of [c.text, c.textSecondary])
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('textTertiary is below 4.5:1 on bg, so it is reserved for large text', () =>
    expect(contrastRatio(c.textTertiary, c.bg)).toBeLessThan(4.5));
  it('cream passes 4.5:1 on accent; gold passes 3:1 on accent', () => {
    expect(contrastRatio(c.cream, c.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.gold, c.accent)).toBeGreaterThanOrEqual(3);
  });
  it('error, success, warning and accent2 pass 4.5:1 on bg and surface', () => {
    for (const bg of [c.bg, c.surface])
      for (const fg of [c.error, c.success, c.warning, c.accent2])
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('white passes 4.5:1 on accent, accentHover and accentPressed', () => {
    for (const bg of [c.accent, c.accentHover, c.accentPressed])
      expect(contrastRatio('#FFFFFF', bg)).toBeGreaterThanOrEqual(4.5);
  });
  it('focus ring has 3:1 against bg and surface', () => {
    for (const bg of [c.bg, c.surface])
      expect(contrastRatio(c.focus, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('build-css', () => {
  const css = buildCss();
  it('emits a custom property for every colour token', () => {
    for (const k of Object.keys(c)) {
      const name = k.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      expect(css).toContain(`--color-${name}: ${c[k as keyof typeof c]};`);
    }
    expect(css.match(/--color-/g)).toHaveLength(Object.keys(c).length);
  });
  it('emits spacing, radii, fonts and grain', () => {
    expect(css).toContain('--space-1: 4px;');
    expect(css).toContain('--space-8: 64px;');
    expect(css).toContain('--radius-cover: 2px;');
    expect(css).toContain('--radius-popover: 8px;');
    expect(css).toContain(`--font-editorial: ${tokens.font.editorial};`);
    expect(css).toContain('--font-interface: Inter, system-ui, sans-serif;');
    expect(css).toContain(`--texture-grain: ${tokens.texture.grain};`);
  });
  it('declares a light theme selector and no dark values', () => {
    expect(css).toContain('[data-theme="light"]');
    expect(css).not.toContain('dark');
  });
});

describe('writeIfChanged', () => {
  it('creates the file and its directory, then skips identical content', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'design-')), 'dist', 'tokens.css');
    expect(writeIfChanged(out, 'a')).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe('a');

    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(out, old, old);
    expect(writeIfChanged(out, 'a')).toBe(false);
    expect(statSync(out).mtime.getTime()).toBe(old.getTime());

    expect(writeIfChanged(out, 'b')).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe('b');
  });
});
