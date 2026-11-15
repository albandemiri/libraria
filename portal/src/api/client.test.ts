import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveApiUrl } from './client';

afterEach(() => vi.unstubAllEnvs());

describe('resolveApiUrl', () => {
  it('resolves a path against an absolute API base origin', () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.libraria.example/api/v1');
    expect(resolveApiUrl('/api/v1/books/b1/cover?v=2')).toBe(
      'https://api.libraria.example/api/v1/books/b1/cover?v=2',
    );
  });

  it('leaves the path unchanged for a relative base', () => {
    vi.stubEnv('VITE_API_BASE', '/api/v1');
    expect(resolveApiUrl('/api/v1/books/b1/cover?v=2')).toBe('/api/v1/books/b1/cover?v=2');
  });

  it('leaves an external legacy cover URL alone', () => {
    vi.stubEnv('VITE_API_BASE', 'https://api.libraria.example/api/v1');
    expect(resolveApiUrl('https://covers.example/x.jpg')).toBe('https://covers.example/x.jpg');
  });
});
