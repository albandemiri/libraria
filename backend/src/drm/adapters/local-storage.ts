import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export class InvalidObjectKeyError extends Error {
  constructor() {
    super('Invalid object key');
    this.name = 'InvalidObjectKeyError';
  }
}

const KEY_PATTERN = /^(quarantine|assets|covers)\/[A-Za-z0-9._/-]+$/;

/** Filesystem-backed object storage for development and single-node deployments. */
export class LocalObjectStorage {
  private readonly root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  /** Validates the key and maps it to a path that is guaranteed to stay under the root. */
  private resolveKey(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new InvalidObjectKeyError();
    // The pattern allows dots and slashes, so rule out traversal and degenerate segments.
    if (key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new InvalidObjectKeyError();
    }
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new InvalidObjectKeyError();
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolveKey(key);
    await mkdir(path.dirname(target), { recursive: true });
    // Write beside the target, then rename: readers see the old or the new object, never a partial one.
    const temp = `${target}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      const handle = await open(temp, 'w');
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temp, target);
    } catch (err) {
      await rm(temp, { force: true });
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async getRange(key: string, start: number, endInclusive: number): Promise<Buffer> {
    const handle = await open(this.resolveKey(key), 'r');
    try {
      const size = (await handle.stat()).size;
      if (start < 0 || start >= size || endInclusive < start) return Buffer.alloc(0);
      // Clamp before allocating, then loop: one read() may return fewer bytes than asked.
      const length = Math.min(endInclusive, size - 1) - start + 1;
      const buffer = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const { bytesRead } = await handle.read(buffer, filled, length - filled, start + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
      }
      return buffer.subarray(0, filled);
    } finally {
      await handle.close();
    }
  }

  /** Streams the object, or an inclusive byte range of it; the file closes when the stream ends or is destroyed. */
  async createReadStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const handle = await open(this.resolveKey(key), 'r');
    return handle.createReadStream({ ...(range && { start: range.start, end: range.end }) });
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(this.resolveKey(key));
      return info.isFile() ? { size: info.size } : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Objects directly under a prefix such as `quarantine/`, with their last-modified time. */
  async list(prefix: string): Promise<Array<{ key: string; modifiedAt: Date }>> {
    const folder = prefix.replace(/\/+$/, '');
    // Validates the prefix like any key and keeps the directory under the root.
    const dir = path.dirname(this.resolveKey(`${folder}/x`));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const found: Array<{ key: string; modifiedAt: Date }> = [];
    for (const name of names) {
      const key = `${folder}/${name}`;
      if (!KEY_PATTERN.test(key)) continue;
      try {
        const info = await stat(path.join(dir, name));
        if (info.isFile()) found.push({ key, modifiedAt: info.mtime });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return found;
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
