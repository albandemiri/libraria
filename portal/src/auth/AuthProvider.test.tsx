import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNAUTHORIZED_EVENT } from '../api/client';
import { AuthProvider, useAuth } from './AuthProvider';

const admin = {
  id: 'a1',
  email: 'a@example.com',
  displayName: null,
  role: 'admin',
  publisherId: null,
  createdAt: '2026-01-01T00:00:00Z',
};

function stubMe(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            status === 200 ? { user: admin } : { error: { code: 'UNAUTHORIZED', message: 'x' } },
          ),
          { status, headers: { 'Content-Type': 'application/json' } },
        ),
    ),
  );
}

function Probe() {
  const { status, expired } = useAuth();
  return <p>{`${status} ${expired ? 'expired' : 'fresh'}`}</p>;
}

function setup() {
  const client = new QueryClient();
  client.setQueryData(['keep-me'], 'value');
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => vi.unstubAllGlobals());

describe('AuthProvider and the 401 event', () => {
  it('does not clear the cache for an anonymous visitor (first /auth/me, failed login)', async () => {
    stubMe(401);
    const client = setup();
    await screen.findByText('anonymous fresh');
    expect(client.getQueryData(['keep-me'])).toBe('value');
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(client.getQueryData(['keep-me'])).toBe('value');
  });

  it('clears the cache when a signed-in session expires', async () => {
    stubMe(200);
    const client = setup();
    await screen.findByText('authenticated fresh');
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    await waitFor(() => expect(screen.getByText('anonymous expired')).toBeInTheDocument());
    expect(client.getQueryData(['keep-me'])).toBeUndefined();
  });
});
