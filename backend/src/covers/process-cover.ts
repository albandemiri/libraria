import sharp from 'sharp';
import { sniffImageType } from './sniff';

export type CoverErrorCode =
  | 'COVER_TOO_LARGE'
  | 'COVER_UNSUPPORTED_TYPE'
  | 'COVER_TOO_SMALL'
  | 'COVER_BAD_SHAPE'
  | 'COVER_INVALID'
  | 'COVER_BUSY';

export class CoverError extends Error {
  constructor(
    readonly code: CoverErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CoverError';
  }
}

/** Thrown when the caller went away while the image was waiting for a slot. */
export class CoverCancelled extends Error {
  constructor() {
    super('The upload was cancelled');
    this.name = 'CoverCancelled';
  }
}

export const COVER_MAX_BYTES = 10 * 1024 * 1024;
const MAX_INPUT_PIXELS = 40_000_000;
const MIN_WIDTH = 400;
/** Book covers are about 2:3; anything longer than this is not one. */
const MAX_ASPECT = 3;
const MAX_LONG_SIDE = 2400;
const THUMB_WIDTH = 480;
const THUMB_HEIGHT = 720;
const JPEG_QUALITY = 85;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Only JPEG, PNG and WebP are ever decoded. Every other loader libvips was built
// with is switched off for the whole process, so a file that slips past the
// magic-byte check still cannot reach it (SVG, TIFF, HEIF, GIF, JPEG 2000,
// ImageMagick, PDF, FITS, OpenSlide and Matrix). These are libvips operation
// class names; each covers its File, Buffer and Source variants.
sharp.block({
  operation: [
    'VipsForeignLoadSvg',
    'VipsForeignLoadTiff',
    'VipsForeignLoadHeif',
    'VipsForeignLoadNsgif',
    'VipsForeignLoadJp2k',
    'VipsForeignLoadMagick',
    'VipsForeignLoadMagick7',
    'VipsForeignLoadPdf',
    'VipsForeignLoadFits',
    'VipsForeignLoadOpenslide',
    'VipsForeignLoadMatrix',
  ],
});

/** Image decoding is CPU and memory heavy: a few run at once, a few wait, the rest are turned away. */
const MAX_CONCURRENT = 2;
const MAX_WAITING = 8;
let running = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) {
    if (waiting.length >= MAX_WAITING) {
      throw new CoverError('COVER_BUSY', 'Too many images are being processed. Try again shortly.');
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    running++;
  }
  try {
    return await work();
  } finally {
    const nextInLine = waiting.shift();
    if (nextInLine)
      nextInLine(); // hands the slot over
    else running--;
  }
}

/** The decoder settings: a pixel ceiling, and any decode error is fatal (no half-rendered images). */
const decoderOptions = { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' } as const;

async function encode(input: Buffer) {
  const meta = await sharp(input, decoderOptions).metadata();
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new CoverError('COVER_UNSUPPORTED_TYPE', 'Only JPEG, PNG and WebP images are accepted.');
  }
  // EXIF orientations 5 to 8 swap the axes when rotated upright.
  const rotatesSideways = (meta.orientation ?? 1) >= 5;
  const displayWidth = rotatesSideways ? meta.height : meta.width;
  const displayHeight = rotatesSideways ? meta.width : meta.height;
  if (!displayWidth || !displayHeight || displayWidth < MIN_WIDTH) {
    throw new CoverError('COVER_TOO_SMALL', `The image must be at least ${MIN_WIDTH} px wide.`);
  }
  if (Math.max(displayWidth, displayHeight) > MAX_ASPECT * Math.min(displayWidth, displayHeight)) {
    throw new CoverError('COVER_BAD_SHAPE', 'The image is too long and narrow for a book cover.');
  }

  // No withMetadata(): EXIF, GPS, XMP, IPTC, comments and ICC profiles are all dropped.
  const main = await sharp(input, decoderOptions)
    .rotate()
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .resize({
      width: MAX_LONG_SIDE,
      height: MAX_LONG_SIDE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer({ resolveWithObject: true });
  // From the already small, upright result: the input is decoded only once.
  const thumb = await sharp(main.data)
    .resize({ width: THUMB_WIDTH, height: THUMB_HEIGHT, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return { main: main.data, thumb, width: main.info.width, height: main.info.height };
}

/**
 * Validates and re-encodes an uploaded cover. The type is checked from the
 * magic bytes before sharp sees a single byte, and again from the decoder's
 * answer. The byte size is the route's concern. `cancelled` is polled once a
 * slot is free, so work for a caller who already left is skipped.
 */
export async function processCover(
  input: Buffer,
  options: { cancelled?: () => boolean } = {},
): Promise<{ main: Buffer; thumb: Buffer; width: number; height: number }> {
  if (input.length === 0) throw new CoverError('COVER_INVALID', 'The image is empty.');
  const type = sniffImageType(input);
  if (!type || !ACCEPTED_TYPES.has(type)) {
    throw new CoverError('COVER_UNSUPPORTED_TYPE', 'Only JPEG, PNG and WebP images are accepted.');
  }
  try {
    return await withSlot(() => {
      if (options.cancelled?.()) throw new CoverCancelled();
      return encode(input);
    });
  } catch (err) {
    if (err instanceof CoverError || err instanceof CoverCancelled) throw err;
    throw new CoverError('COVER_INVALID', 'The image could not be read.');
  }
}
