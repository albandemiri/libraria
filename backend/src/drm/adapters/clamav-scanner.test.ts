import assert from 'node:assert/strict';
import net from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { ClamavScanner } from './clamav-scanner';

type Handler = (received: Buffer, socket: net.Socket) => void;

const sockets = new Set<net.Socket>();
const servers: net.Server[] = [];

/** A fake clamd: calls `onTerminated` once the zero-length INSTREAM terminator arrives. */
async function fakeClamd(onTerminated: Handler): Promise<number> {
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) onTerminated(buf, socket);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as net.AddressInfo).port;
}

async function closeServers(): Promise<void> {
  for (const s of sockets) s.destroy();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
}

afterEach(closeServers);

describe('ClamavScanner', () => {
  it('sends zINSTREAM with length-prefixed chunks and maps "OK" to clean', async () => {
    let seen: Buffer = Buffer.alloc(0);
    const port = await fakeClamd((buf, socket) => {
      seen = buf;
      socket.end('stream: OK\0');
    });
    const data = Buffer.from('some bytes');
    const result = await new ClamavScanner('127.0.0.1', port).scan(data);
    assert.deepEqual(result, { result: 'clean' });
    assert.equal(seen.subarray(0, 10).toString('latin1'), 'zINSTREAM\0');
    assert.equal(seen.readUInt32BE(10), data.length);
    assert.equal(seen.subarray(14, 14 + data.length).toString(), 'some bytes');
    assert.deepEqual(seen.subarray(14 + data.length), Buffer.alloc(4));
  });

  it('splits large payloads into several chunks', async () => {
    let seen: Buffer = Buffer.alloc(0);
    const port = await fakeClamd((buf, socket) => {
      seen = buf;
      socket.end('stream: OK\0');
    });
    const data = Buffer.alloc(300_000, 1);
    await new ClamavScanner('127.0.0.1', port).scan(data);
    // Header 10 + payload + terminator 4, plus one 4-byte length per chunk (at least two chunks).
    assert.ok(seen.length >= 10 + data.length + 4 + 8);
  });

  it('maps FOUND to infected with the signature', async () => {
    const port = await fakeClamd((_buf, socket) => {
      socket.end('stream: Eicar-Test-Signature FOUND\0');
    });
    const result = await new ClamavScanner('127.0.0.1', port).scan(Buffer.from('x'));
    assert.deepEqual(result, { result: 'infected', signature: 'Eicar-Test-Signature' });
  });

  it('maps an unrecognised reply to error', async () => {
    const port = await fakeClamd((_buf, socket) => {
      socket.end('INSTREAM size limit exceeded. ERROR\0');
    });
    const result = await new ClamavScanner('127.0.0.1', port).scan(Buffer.from('x'));
    assert.equal(result.result, 'error');
  });

  it('returns error when the connection is refused', async () => {
    const port = await fakeClamd(() => undefined);
    await closeServers();
    const result = await new ClamavScanner('127.0.0.1', port).scan(Buffer.from('x'));
    assert.equal(result.result, 'error');
  });

  it('returns error when the server never replies, after the injected timeout', async () => {
    const port = await fakeClamd(() => undefined);
    const started = Date.now();
    const result = await new ClamavScanner('127.0.0.1', port, 100).scan(Buffer.from('x'));
    assert.equal(result.result, 'error');
    assert.ok(Date.now() - started < 3000);
  });
});
