import { afterEach, describe, expect, it, vi } from 'vitest';
import { readImageSize } from './image';

const file = new File(['x'], 'c.png', { type: 'image/png' });
afterEach(() => vi.unstubAllGlobals());

describe('readImageSize', () => {
  it('returns null when createImageBitmap is missing', async () => {
    vi.stubGlobal('createImageBitmap', undefined);
    expect(await readImageSize(file)).toBeNull();
  });

  it('returns null when decoding throws', async () => {
    vi.stubGlobal('createImageBitmap', async () => {
      throw new Error('bad image');
    });
    expect(await readImageSize(file)).toBeNull();
  });

  it('reads the size honouring EXIF orientation, and closes the bitmap', async () => {
    const close = vi.fn();
    const create = vi.fn(async () => ({ width: 900, height: 600, close }));
    vi.stubGlobal('createImageBitmap', create);
    expect(await readImageSize(file)).toEqual({ width: 900, height: 600 });
    expect(create).toHaveBeenCalledWith(file, { imageOrientation: 'from-image' });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
