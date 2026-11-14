import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { InvalidObjectKeyError, LocalObjectStorage } from './local-storage';

describe('LocalObjectStorage', () => {
  let root: string;
  let dir: string;
  let storage: LocalObjectStorage;

  before(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'libraria-storage-'));
    dir = path.join(root, 'not-yet-created');
    storage = new LocalObjectStorage(dir);
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('creates the storage directory on demand and round-trips put, get, head', async () => {
    const data = Buffer.from('hello world');
    await storage.put('assets/a/b.bin', data);
    assert.deepEqual(await storage.get('assets/a/b.bin'), data);
    assert.deepEqual(await storage.head('assets/a/b.bin'), { size: 11 });
  });

  it('returns an inclusive byte range', async () => {
    await storage.put('covers/r.bin', Buffer.from('0123456789'));
    const part = await storage.getRange('covers/r.bin', 2, 5);
    assert.equal(part.length, 4);
    assert.equal(part.toString(), '2345');
  });

  it('overwrites atomically and leaves no temporary files behind', async () => {
    await storage.put('quarantine/o.bin', Buffer.from('one'));
    await storage.put('quarantine/o.bin', Buffer.from('two'));
    assert.equal((await storage.get('quarantine/o.bin')).toString(), 'two');
    const names = await readdir(path.join(dir, 'quarantine'));
    assert.deepEqual(names, ['o.bin']);
  });

  it('deletes, after which head is null; deleting a missing key is a no-op', async () => {
    await storage.put('assets/d.bin', Buffer.from('x'));
    await storage.delete('assets/d.bin');
    assert.equal(await storage.head('assets/d.bin'), null);
    await storage.delete('assets/d.bin');
  });

  it('rejects unsafe or foreign keys', async () => {
    for (const key of ['../x', 'assets/../../etc', '/abs', 'other/x', 'assets/a\\b', 'assets/']) {
      await assert.rejects(storage.put(key, Buffer.from('x')), InvalidObjectKeyError, key);
      await assert.rejects(storage.get(key), InvalidObjectKeyError, key);
      await assert.rejects(storage.head(key), InvalidObjectKeyError, key);
      await assert.rejects(storage.delete(key), InvalidObjectKeyError, key);
    }
  });
});

describe('LocalObjectStorage.createReadStream', () => {
  it('streams the whole object or an inclusive range, and validates keys', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'libraria-stream-'));
    try {
      const storage = new LocalObjectStorage(dir);
      await storage.put('covers/s.bin', Buffer.from('0123456789'));
      const read = async (range?: { start: number; end: number }) => {
        const chunks: Buffer[] = [];
        for await (const chunk of await storage.createReadStream('covers/s.bin', range)) {
          chunks.push(chunk as Buffer);
        }
        return Buffer.concat(chunks).toString();
      };
      assert.equal(await read(), '0123456789');
      assert.equal(await read({ start: 2, end: 5 }), '2345');
      await assert.rejects(storage.createReadStream('../x'), InvalidObjectKeyError);
      await assert.rejects(storage.createReadStream('covers/missing.bin'), /ENOENT/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('getRange fills the requested length even across short reads', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'libraria-range-'));
    try {
      const storage = new LocalObjectStorage(dir);
      const big = Buffer.alloc(3 * 1024 * 1024, 7);
      await storage.put('covers/big.bin', big);
      assert.equal(
        (await storage.getRange('covers/big.bin', 0, big.length - 1)).length,
        big.length,
      );
      assert.equal(
        (await storage.getRange('covers/big.bin', 10, 1_000_000_000)).length,
        big.length - 10,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
