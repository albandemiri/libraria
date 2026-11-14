import type { Readable } from 'node:stream';
import { env } from '../config/env';
import { LocalObjectStorage } from './adapters/local-storage';

export { InvalidObjectKeyError } from './adapters/local-storage';

export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  getRange(key: string, start: number, endInclusive: number): Promise<Buffer>;
  /** Streams an object or an inclusive byte range; destroy the stream to release it. */
  createReadStream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  head(key: string): Promise<{ size: number } | null>;
  /** Objects directly under a prefix such as `quarantine/`. */
  list(prefix: string): Promise<Array<{ key: string; modifiedAt: Date }>>;
  delete(key: string): Promise<void>;
}

let instance: ObjectStorage | undefined;
let override: ObjectStorage | null = null;

export function objectStorage(): ObjectStorage {
  if (override) return override;
  if (!instance) {
    switch (env.STORAGE_PROVIDER) {
      case 'local':
        instance = new LocalObjectStorage(env.ASSET_STORAGE_DIR);
        break;
    }
  }
  return instance as ObjectStorage;
}

/** Test seam: inject a storage, or pass null to restore the env-chosen one. */
export function setObjectStorageForTests(storage: ObjectStorage | null): void {
  override = storage;
}
