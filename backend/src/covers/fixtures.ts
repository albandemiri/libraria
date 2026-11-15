import { crc32, deflateSync } from 'node:zlib';

/** A tiny, valid-looking PNG whose header declares far more pixels than its data holds. */
export function pixelBombPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(16))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Inserts a JPEG comment (COM) and an IPTC-style APP13 segment right after the
 * SOI marker, the kind of metadata a re-encode must not carry over.
 */
export function jpegWithComment(jpeg: Buffer, comment: string, iptc: string): Buffer {
  const segment = (marker: number, payload: Buffer) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([head, payload]);
  };
  return Buffer.concat([
    jpeg.subarray(0, 2),
    segment(0xfe, Buffer.from(comment)),
    segment(0xed, Buffer.from(`Photoshop 3.0\0${iptc}`)),
    jpeg.subarray(2),
  ]);
}
