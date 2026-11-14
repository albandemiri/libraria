import type { ScanResult } from '../malware-scanner';

/** Scans nothing and calls everything clean. Development only; refused in production. */
export class NoneScanner {
  scan(): Promise<ScanResult> {
    return Promise.resolve({ result: 'clean' });
  }
}
