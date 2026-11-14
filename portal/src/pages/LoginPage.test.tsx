import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNAUTHORIZED_EVENT } from '../api/client';
import { AuthProvider } from '../auth/AuthProvider';
import i18n from '../i18n';
import LoginPage from './LoginPage';

function json(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const unauthenticated = json(401, {
  error: { code: 'UNAUTHENTICATED', message: 'no', requestId: 'r' },
});

function renderPage() {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider>
            <LoginPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText('Email'), 'pub@example.com');
  await user.type(screen.getByLabelText('Password'), 'secret-password');
  await user.click(screen.getByLabelText('Remember me'));
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  const fetchMock = vi.fn();

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    await i18n.changeLanguage('en');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the credentials with rememberMe and the portal header', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/me')
        ? unauthenticated.clone()
        : json(200, {
            user: {
              id: 'u1',
              email: 'pub@example.com',
              displayName: null,
              role: 'publisher',
              publisherId: 'p1',
              createdAt: '2026-01-01T00:00:00Z',
            },
          }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) =>
        String(url).endsWith('/api/v1/auth/portal/login'),
      );
      expect(call).toBeDefined();
      const init = call?.[1] as RequestInit;
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(new Headers(init.headers).get('X-Libraria-Portal')).toBe('1');
      expect(JSON.parse(String(init.body))).toEqual({
        email: 'pub@example.com',
        password: 'secret-password',
        rememberMe: true,
      });
    });
  });

  it('shows the translated portal-access-denied message', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/me')
        ? unauthenticated.clone()
        : json(403, { error: { code: 'PORTAL_ACCESS_DENIED', message: 'x', requestId: 'r' } }),
    );
    const user = userEvent.setup();
    renderPage();
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This portal is for publishing partners',
    );
  });

  it('re-renders labels in Albanian when the language is switched', async () => {
    fetchMock.mockImplementation(async () => unauthenticated.clone());
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Shqip' }));
    expect(await screen.findByLabelText('Fjalëkalimi')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hyr' })).toBeInTheDocument();
  });

  const me = {
    user: {
      id: 'u1',
      email: 'pub@example.com',
      displayName: null,
      role: 'publisher',
      publisherId: 'p1',
      createdAt: '2026-01-01T00:00:00Z',
    },
  };

  it('says the session expired when a signed-in session gets a 401', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/me') ? json(200, me) : unauthenticated.clone(),
    );
    renderPage();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Your session has expired. Please sign in again.',
    );
  });

  it('does not say the session expired on the first visit or a failed login', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/auth/me')
        ? unauthenticated.clone()
        : json(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x', requestId: 'r' } }),
    );
    const user = userEvent.setup();
    renderPage();
    await screen.findByLabelText('Email');
    expect(screen.queryByText(/session has expired/)).not.toBeInTheDocument();
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The email or password is incorrect.',
    );
    expect(screen.queryByText(/session has expired/)).not.toBeInTheDocument();
  });
});
