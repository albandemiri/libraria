import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Font, type Glyph, type Path, parse } from 'opentype.js';

/**
 * Typographic covers for the demo books, drawn locally.
 *
 * The title is set in Instrument Serif and the author and label in Inter (both SIL OFL,
 * installed as dev dependencies, never downloaded at run time). Text is turned into SVG
 * path data with opentype.js, so the SVG holds paths only: no font reference, and no
 * system font needed. A child process rasterises it (see demo-cover-raster.cjs), which
 * keeps the server's `sharp.block` of the SVG loader intact.
 */

export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 2400;
const MARGIN = 170;
export const COVER_INNER_WIDTH = COVER_WIDTH - 2 * MARGIN;
export const COVER_MAX_TITLE_LINES = 5;

const TITLE_MAX_SIZE = 280;
const TITLE_MIN_SIZE = 24;
const TITLE_LINE_HEIGHT = 1.06;

export interface CoverSpec {
  title: string;
  author: string;
  /** A short uppercase-able tag above the title, such as the genre. */
  label: string;
  background: string;
  accent: string;
  ink: string;
}

export type CoverFont = 'serif' | 'sans';

const fontFiles: Record<CoverFont, string> = {
  serif: '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff',
  sans: '@fontsource/inter/files/inter-latin-600-normal.woff',
};
const fonts = new Map<CoverFont, Font>();

function loadFont(name: CoverFont): Font {
  let font = fonts.get(name);
  if (!font) {
    const file = readFileSync(require.resolve(fontFiles[name]));
    font = parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
    fonts.set(name, font);
  }
  return font;
}

/** Characters the font has no glyph for (it would draw `.notdef`). */
export function missingGlyphs(text: string, name: CoverFont): string[] {
  const font = loadFont(name);
  return [...new Set([...text])].filter(
    (character) => character !== ' ' && font.charToGlyph(character).index === 0,
  );
}

interface Run {
  /** SVG path data, left edge at x = 0 on the baseline. */
  glyphs: Array<{ glyph: Glyph; x: number }>;
  width: number;
}

/** Lays out one line. `tracking` is extra space between letters, in em. */
function layout(text: string, name: CoverFont, size: number, tracking = 0): Run {
  const font = loadFont(name);
  const scale = size / font.unitsPerEm;
  const glyphs: Run['glyphs'] = [];
  let x = 0;
  let previous: Glyph | null = null;
  for (const character of [...text]) {
    const glyph = font.charToGlyph(character);
    if (previous) {
      try {
        const kerning = font.getKerningValue(previous, glyph);
        // A sane pair adjustment only: a misread table must never move the text.
        if (Number.isFinite(kerning) && Math.abs(kerning) < font.unitsPerEm * 0.25) {
          x += kerning * scale;
        }
      } catch {
        // A kerning table this parser cannot read: no kerning.
      }
    }
    glyphs.push({ glyph, x });
    x += (glyph.advanceWidth ?? 0) * scale + tracking * size;
    previous = glyph;
  }
  return { glyphs, width: x - (glyphs.length > 0 ? tracking * size : 0) };
}

const widthOf = (text: string, name: CoverFont, size: number, tracking = 0) =>
  layout(text, name, size, tracking).width;

/** Splits a word that cannot fit one line into pieces that do, with a hyphen between them. */
function breakWord(word: string, size: number): string[] {
  const pieces: string[] = [];
  let piece = '';
  for (const character of [...word]) {
    if (piece && widthOf(`${piece}${character}-`, 'serif', size) > COVER_INNER_WIDTH) {
      pieces.push(`${piece}-`);
      piece = '';
    }
    piece += character;
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function wrapTitle(words: string[], size: number, breakLongWords: boolean): string[] | null {
  const lines: string[] = [];
  let current = '';
  const flush = () => {
    if (current) lines.push(current);
    current = '';
  };
  for (const word of words) {
    if (widthOf(word, 'serif', size) > COVER_INNER_WIDTH) {
      if (!breakLongWords) return null;
      flush();
      const pieces = breakWord(word, size);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? '';
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (current && widthOf(candidate, 'serif', size) > COVER_INNER_WIDTH) {
      flush();
      current = word;
    } else {
      current = candidate;
    }
  }
  flush();
  return lines;
}

export interface TitleLayout {
  size: number;
  lines: string[];
}

/**
 * The largest size at which the title fits: wrapped to the width, at most five lines.
 * A word wider than the page is broken with hyphens only when no size avoids it.
 */
export function layoutTitle(title: string): TitleLayout {
  const words = title.split(/\s+/).filter(Boolean);
  for (const breakLongWords of [false, true]) {
    for (let size = TITLE_MAX_SIZE; size >= TITLE_MIN_SIZE; size -= 4) {
      const lines = wrapTitle(words, size, breakLongWords);
      if (lines && lines.length <= COVER_MAX_TITLE_LINES) return { size, lines };
    }
  }
  // Unreachable in practice (24 px fits any realistic title); keep the cover valid anyway.
  return {
    size: TITLE_MIN_SIZE,
    lines: (wrapTitle(words, TITLE_MIN_SIZE, true) ?? []).slice(0, 5),
  };
}

/**
 * SVG path data from a glyph's commands. opentype.js's own toPathData can print NaN for
 * some glyphs, which makes the SVG renderer drop the rest of the path, so write it here.
 */
function serialise(path: Path): string {
  const n = (value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) {
      throw new Error('A glyph produced a non-finite coordinate');
    }
    return value.toFixed(2);
  };
  return path.commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${n(c.x)} ${n(c.y)}`;
        case 'Q':
          return `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
        case 'C':
          return `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
        default:
          return 'Z';
      }
    })
    .join('');
}

function pathData(run: Run, size: number, left: number, baseline: number): string {
  return run.glyphs
    .map(({ glyph, x }) => serialise(glyph.getPath(left + x, baseline, size)))
    .join('');
}

/** Letter-spaced uppercase Inter, shrunk until it fits the width. */
function sansLine(text: string, startSize: number, tracking: number) {
  const upper = text.toLocaleUpperCase('sq');
  let size = startSize;
  while (size > 20 && widthOf(upper, 'sans', size, tracking) > COVER_INNER_WIDTH) size -= 2;
  return { run: layout(upper, 'sans', size, tracking), size };
}

/** The cover as an SVG made of paths only. The same spec always gives the same markup. */
export function buildCoverSvg(spec: CoverSpec): string {
  const parts: string[] = [];
  const add = (d: string, fill: string) => parts.push(`<path fill="${fill}" d="${d}"/>`);
  const centred = (run: Run) => (COVER_WIDTH - run.width) / 2;

  // Label, with a short rule under it.
  const label = sansLine(spec.label, 44, 0.28);
  add(pathData(label.run, label.size, centred(label.run), 330), spec.accent);
  const rule = `<rect fill="${spec.accent}" x="${COVER_WIDTH / 2 - 60}" y="400" width="120" height="5"/>`;

  // Title, centred as a block on the upper two thirds of the page.
  const { size, lines } = layoutTitle(spec.title);
  const lineHeight = size * TITLE_LINE_HEIGHT;
  const blockHeight = lineHeight * lines.length;
  const first = 1120 - blockHeight / 2 + size * 0.78;
  for (const [index, line] of lines.entries()) {
    const run = layout(line, 'serif', size);
    add(pathData(run, size, centred(run), first + index * lineHeight), spec.ink);
  }

  // A thin rule and the author near the bottom.
  const authorRule = `<rect fill="${spec.accent}" x="${MARGIN}" y="2010" width="${COVER_INNER_WIDTH}" height="3"/>`;
  const author = sansLine(spec.author, 58, 0.2);
  add(pathData(author.run, author.size, centred(author.run), 2130), spec.ink);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}">`,
    `<rect fill="${spec.background}" width="${COVER_WIDTH}" height="${COVER_HEIGHT}"/>`,
    rule,
    authorRule,
    ...parts,
    '</svg>',
  ].join('');
}

/** A 1600x2400 JPEG cover. The same spec always gives the same picture. */
export function renderCover(spec: CoverSpec): Promise<Buffer> {
  const svg = buildCoverSvg(spec);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'demo-cover-raster.cjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`Cover rasteriser failed: ${Buffer.concat(err).toString()}`));
    });
    child.stdin.end(svg);
  });
}
