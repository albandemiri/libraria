import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { jpegWithComment, pixelBombPng } from './fixtures';
import { CoverCancelled, CoverError, processCover } from './process-cover';

async function jpeg(
  width: number,
  height: number,
  configure: (s: sharp.Sharp) => sharp.Sharp = (s) => s,
): Promise<Buffer> {
  const base = sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  });
  return configure(base.jpeg()).toBuffer();
}

async function rejection(input: Buffer): Promise<string> {
  try {
    await processCover(input);
  } catch (err) {
    assert.ok(err instanceof CoverError, `expected CoverError, got ${err}`);
    return err.code;
  }
  assert.fail('expected processCover to throw');
}

describe('processCover', () => {
  it('strips EXIF and GPS', async () => {
    const input = await jpeg(600, 900, (s) =>
      s.withExif({
        IFD0: { Copyright: 'Someone' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '41/1 19/1 0/1' },
      }),
    );
    assert.ok((await sharp(input).metadata()).exif, 'fixture must carry EXIF');
    const { main, thumb } = await processCover(input);
    for (const out of [main, thumb]) {
      const meta = await sharp(out).metadata();
      assert.equal(meta.exif, undefined);
      assert.equal(meta.xmp, undefined);
      assert.equal(meta.icc, undefined);
    }
  });

  it('applies EXIF orientation', async () => {
    const input = await jpeg(600, 900, (s) => s.withMetadata({ orientation: 6 }));
    const { main, width, height } = await processCover(input);
    const meta = await sharp(main).metadata();
    assert.equal(meta.width, 900);
    assert.equal(meta.height, 600);
    assert.deepEqual([width, height], [900, 600]);
  });

  it('flattens alpha on white', async () => {
    const input = await sharp({
      create: { width: 500, height: 500, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const { main } = await processCover(input);
    const { data } = await sharp(main).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] >= 253 && data[1] >= 253 && data[2] >= 253);
  });

  it('outputs JPEG for every accepted input type', async () => {
    const png = await sharp({
      create: { width: 500, height: 700, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
    const webp = await sharp(png).webp().toBuffer();
    for (const input of [png, webp, await jpeg(500, 700)]) {
      assert.equal((await sharp((await processCover(input)).main).metadata()).format, 'jpeg');
    }
  });

  it('resizes the long side to 2400 and never enlarges', async () => {
    const big = await processCover(await jpeg(3000, 4500));
    const bigMeta = await sharp(big.main).metadata();
    assert.deepEqual([bigMeta.width, bigMeta.height], [1600, 2400]);
    assert.deepEqual([big.width, big.height], [1600, 2400]);

    const small = await processCover(await jpeg(800, 1200));
    const smallMeta = await sharp(small.main).metadata();
    assert.deepEqual([smallMeta.width, smallMeta.height], [800, 1200]);
  });

  it('thumbnail is 480 wide', async () => {
    const { thumb } = await processCover(await jpeg(1600, 2400));
    const meta = await sharp(thumb).metadata();
    assert.equal(meta.width, 480);
    assert.equal(meta.height, 720);
    assert.equal(meta.format, 'jpeg');
  });

  it('rejects under 400 px wide', async () => {
    assert.equal(await rejection(await jpeg(399, 600)), 'COVER_TOO_SMALL');
  });

  it('measures the width after rotation', async () => {
    // 600 x 300 stored, orientation 6: displays 300 wide.
    const input = await jpeg(600, 300, (s) => s.withMetadata({ orientation: 6 }));
    assert.equal(await rejection(input), 'COVER_TOO_SMALL');
  });

  it('rejects a pixel bomb without decoding it', async () => {
    const bomb = pixelBombPng(20000, 20000);
    assert.ok(bomb.length < 200);
    assert.equal(await rejection(bomb), 'COVER_INVALID');
  });

  it('rejects SVG, GIF and text renamed .jpg', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><script>alert(1)</script></svg>',
    );
    const gif = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#000' },
    })
      .gif()
      .toBuffer();
    assert.equal(await rejection(svg), 'COVER_UNSUPPORTED_TYPE');
    assert.equal(await rejection(gif), 'COVER_UNSUPPORTED_TYPE');
    assert.equal(
      await rejection(Buffer.from('this is not an image at all')),
      'COVER_UNSUPPORTED_TYPE',
    );
    assert.equal(await rejection(Buffer.alloc(0)), 'COVER_INVALID');
  });

  it('rejects a truncated JPEG', async () => {
    const noise = randomBytes(800 * 1200 * 3);
    const full = await sharp(noise, { raw: { width: 800, height: 1200, channels: 3 } })
      .jpeg()
      .toBuffer();
    assert.equal(await rejection(full.subarray(0, Math.floor(full.length / 2))), 'COVER_INVALID');
  });

  it('strips IPTC and comment segments', async () => {
    const input = jpegWithComment(await jpeg(600, 900), 'SECRET-COMMENT', 'SECRET-IPTC');
    assert.ok(input.includes('SECRET-COMMENT'));
    const { main, thumb } = await processCover(input);
    for (const out of [main, thumb]) {
      assert.equal(out.includes('SECRET-COMMENT'), false);
      assert.equal(out.includes('SECRET-IPTC'), false);
      assert.equal((await sharp(out).metadata()).iptc, undefined);
    }
  });

  it('rejects a 400 x 60000 image as a bad shape', async () => {
    assert.equal(await rejection(await jpeg(400, 60000)), 'COVER_BAD_SHAPE');
    assert.equal(await rejection(await jpeg(60000, 400)), 'COVER_BAD_SHAPE');
  });

  it('accepts 1:2.9 and keeps the thumbnail within 480 x 720', async () => {
    const { main, thumb } = await processCover(await jpeg(1000, 2900));
    const mainMeta = await sharp(main).metadata();
    assert.deepEqual([mainMeta.width, mainMeta.height], [828, 2400]);
    const meta = await sharp(thumb).metadata();
    assert.ok((meta.width ?? 0) <= 480 && (meta.height ?? 0) <= 720);
    assert.equal(meta.height, 720);
  });

  it('never enlarges a thumbnail beyond the main image', async () => {
    const { thumb } = await processCover(await jpeg(420, 600));
    const meta = await sharp(thumb).metadata();
    assert.deepEqual([meta.width, meta.height], [420, 600]);
  });

  it('refuses by magic bytes before sharp is involved', async () => {
    // If sharp had been asked, its blocked loaders would have turned these into COVER_INVALID.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><script>alert(1)</script></svg>',
    );
    const tiff = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#000' },
    })
      .tiff()
      .toBuffer();
    const fakeTiff = Buffer.concat([Buffer.from([0x49, 0x49, 0x2a, 0x00]), Buffer.alloc(64)]);
    for (const input of [svg, tiff, fakeTiff]) {
      assert.equal(await rejection(input), 'COVER_UNSUPPORTED_TYPE');
    }
    assert.equal(await rejection(Buffer.alloc(0)), 'COVER_INVALID');
  });

  it('keeps the other loaders blocked even if a file got past the magic bytes', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"/>');
    await assert.rejects(sharp(svg).metadata());
    const tiff = await sharp({
      create: { width: 500, height: 500, channels: 3, background: '#000' },
    })
      .tiff()
      .toBuffer();
    await assert.rejects(sharp(tiff).metadata());
  });

  it('turns work away with COVER_BUSY when 2 are running and 8 are waiting', async () => {
    const input = await jpeg(2000, 3000);
    const calls = Array.from({ length: 11 }, () =>
      processCover(input).then(
        () => 'ok',
        (err: CoverError) => err.code,
      ),
    );
    const results = await Promise.all(calls);
    assert.equal(results.filter((r) => r === 'ok').length, 10);
    assert.equal(results.filter((r) => r === 'COVER_BUSY').length, 1);
    // The queue drains: a later call is served again.
    assert.equal((await processCover(input)).width, 1600);
  });

  it('skips work for a caller that went away while waiting', async () => {
    const input = await jpeg(2000, 3000);
    const busy = [processCover(input), processCover(input)];
    const queued = processCover(input, { cancelled: () => true });
    await assert.rejects(queued, CoverCancelled);
    await Promise.all(busy);
  });
});
