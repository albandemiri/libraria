import net from 'node:net';
import type { ScanResult } from '../malware-scanner';

const CHUNK_SIZE = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

/** Scans with clamd over TCP using the null-terminated zINSTREAM command. */
export class ClamavScanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  scan(data: Buffer): Promise<ScanResult> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (result: ScanResult) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve(result);
      };
      const fail = (message: string) => finish({ result: 'error', message });

      socket.setTimeout(this.timeoutMs, () => fail('clamd timed out'));
      socket.on('error', (err) => fail(`clamd connection failed: ${err.message}`));
      socket.on('close', () => {
        if (!settled) finish(parseReply(Buffer.concat(chunks).toString('utf8')));
      });
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));

      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        for (let offset = 0; offset < data.length; offset += CHUNK_SIZE) {
          const chunk = data.subarray(offset, offset + CHUNK_SIZE);
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.write(Buffer.alloc(4));
      });
    });
  }
}

function parseReply(raw: string): ScanResult {
  const reply = raw.replaceAll('\0', '').trim();
  if (/^stream:\s*OK$/.test(reply)) return { result: 'clean' };
  const found = /^stream:\s*(.+?)\s+FOUND$/.exec(reply);
  if (found?.[1]) return { result: 'infected', signature: found[1] };
  return { result: 'error', message: `unexpected clamd reply: ${reply.slice(0, 200)}` };
}
