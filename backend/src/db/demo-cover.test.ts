import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { processCover } from '../covers/process-cover';
import {
  buildCoverSvg,
  COVER_MAX_TITLE_LINES,
  layoutTitle,
  missingGlyphs,
  renderCover,
} from './demo-cover';

const spec = {
  title: 'Shtëpia mbi Lumin e Heshtur',
  author: 'Arta Gjokaj',
  label: 'Prozë',
  background: '#263D32',
  accent: '#C9B88A',
  ink: '#E6DFCF',
};

describe('cover typography', () => {
  it('has glyphs for Albanian letters in both typefaces (no .notdef)', () => {
    const albanian = "ËëÇç Shtëpia Përditshme Çanta Mëngjesit PRODHIM 0123456789 .,:-'";
    assert.deepEqual(missingGlyphs(albanian, 'serif'), []);
    assert.deepEqual(missingGlyphs(albanian, 'sans'), []);
    assert.deepEqual(missingGlyphs('☃', 'serif'), ['☃'], 'sanity: a snowman is missing');
  });

  it('draws ë as its own glyph path, different from e', () => {
    const withDiaeresis = buildCoverSvg({ ...spec, title: 'Ë' });
    const plain = buildCoverSvg({ ...spec, title: 'E' });
    assert.match(withDiaeresis, /<path[^>]* d="M/);
    assert.notEqual(withDiaeresis, plain);
  });

  it('puts only paths in the SVG: no text and no font references', () => {
    assert.doesNotMatch(buildCoverSvg(spec), /<text|font-family|@font-face|<image/);
  });

  it('fits a long title in at most five lines', () => {
    const long =
      'Kronikë e një shekulli të gjatë të heshtur nga qyteti i vjetër mbi lumin e madh dhe udhëtimet e tij';
    const { lines, size } = layoutTitle(long);
    assert.ok(lines.length <= COVER_MAX_TITLE_LINES, `${lines.length} lines`);
    assert.ok(size < 280, 'a long title is set smaller');
    assert.equal(lines.join(' '), long);
    assert.ok(layoutTitle('Era e Marsit').size > size, 'a short title is set larger');
  });

  it('shrinks or breaks very long words and digits instead of overflowing', () => {
    const mixed =
      'Shkrimtarët e Rinj 1984 2024 Pneumonoultramicroscopicsilicovolcanoconiosis Dhjetëvjeçarët';
    assert.ok(layoutTitle(mixed).lines.length <= COVER_MAX_TITLE_LINES);

    const hopeless = `${'Gjatë'.repeat(40)} 1 2 3`;
    const broken = layoutTitle(hopeless);
    assert.ok(broken.lines.length <= COVER_MAX_TITLE_LINES);
    assert.ok(
      broken.lines.some((line) => line.endsWith('-')),
      'a word wider than the page is broken',
    );
  });
});

describe('renderCover', () => {
  it('draws a 1600x2400 JPEG that the real cover pipeline accepts, with its thumbnail', async () => {
    const cover = await renderCover(spec);
    const meta = await sharp(cover).metadata();
    assert.equal(meta.width, 1600);
    assert.equal(meta.height, 2400);
    const processed = await processCover(cover);
    assert.equal(processed.width, 1600);
    assert.equal(processed.height, 2400);
    assert.ok(processed.thumb.length > 0);
  });

  it('is deterministic, and differs for another title', async () => {
    const [a, b, c] = await Promise.all([
      renderCover(spec),
      renderCover(spec),
      renderCover({ ...spec, title: 'Era e Marsit' }),
    ]);
    assert.ok(a.equals(b));
    assert.ok(!a.equals(c));
  });
});

describe('cover paths', () => {
  it('never contain a non-finite coordinate, for every letter of the alphabet', () => {
    const svg = buildCoverSvg({
      ...spec,
      title:
        'Pazari i Vjetër Histori Përditshme Çanta Ëndrra abcdefghijklmnopqrstuvwxyz 0123456789',
      author: 'Abcdefghijklmnopqrstuvwxyz Ëç',
    });
    assert.doesNotMatch(svg, /NaN|Infinity/);
  });
});
