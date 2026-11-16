import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { createRoutesStub } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { createI18n } from '../i18n';
import { commitSession, getSession } from '../server/session.server';
import {
  action as registerAction,
  default as Register,
  loader as registerLoader,
} from './register';
import { action as signInAction, default as SignIn, loader as signInLoader } from './sign-in';
import { action as signOutAction, loader as signOutLoader } from './sign-out';

const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const ORIGIN = 'http://localhost:5174';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiUser(role: string, displayName: string | null = 'Leart') {
  return {
    user: {
      id: 'u1',
      email: 'leart@example.com',
      displayName,
      role,
      publisherId: null,
      createdAt: '2026-01-01',
    },
    token: 'secret-token',
  };
}

function apiError(status: number, code: string, details?: unknown) {
  return json(status, { error: { code, message: 'x', requestId: 'r', details } });
}

function mockFetch(...responses: Response[]) {
  const fn = vi.fn();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// biome-ignore lint/suspicious/noExplicitAny: only the request is used
const args = (request: Request) => ({ request, params: {}, context: {} }) as any;

function post(path: string, fields: Record<string, string>, extra: Record<string, string> = {}) {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, ...extra },
    body: new URLSearchParams(fields),
  });
}

async function sessionOf(res: Response) {
  const cookie = (res.headers.get('Set-Cookie') ?? '').split(';')[0] as string;
  return getSession(new Request(ORIGIN, { headers: { Cookie: cookie } }));
}

describe('sign-in action', () => {
  it('stores the session and redirects to a safe returnTo', async () => {
    const fetchMock = mockFetch(json(200, apiUser('reader')));
    const res = (await signInAction(
      args(post('/hyr', { email: 'leart@example.com', password: 'pw', returnTo: '/libri/7' })),
    )) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/libri/7');
    const session = await sessionOf(res);
    expect(session.get('token')).toBe('secret-token');
    expect(session.get('user')).toEqual({
      id: 'u1',
      email: 'leart@example.com',
      displayName: 'Leart',
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'leart@example.com',
      password: 'pw',
    });
  });

  it('falls back to the email local part and refuses an unsafe returnTo', async () => {
    mockFetch(json(200, apiUser('reader', null)));
    const res = (await signInAction(
      args(
        post('/hyr', { email: 'leart@example.com', password: 'pw', returnTo: '//evil.example' }),
      ),
    )) as Response;
    expect(res.headers.get('Location')).toBe('/');
    expect((await sessionOf(res)).get('user')?.displayName).toBe('leart');
  });

  it.each(['publisher', 'admin'])('refuses %s accounts with the portal message', async (role) => {
    mockFetch(json(200, apiUser(role)));
    const res = await signInAction(
      args(post('/hyr', { email: 'leart@example.com', password: 'pw' })),
    );
    expect(res).not.toBeInstanceOf(Response);
    expect(res).toMatchObject({ portal: true, values: { email: 'leart@example.com' } });
    expect(JSON.stringify(res)).not.toContain('secret-token');
  });

  it('wrong password returns a form error and keeps the email', async () => {
    mockFetch(apiError(401, 'INVALID_CREDENTIALS'));
    const res = await signInAction(
      args(post('/hyr', { email: 'leart@example.com', password: 'nope' })),
    );
    expect(res).toMatchObject({
      formError: 'auth.errors.invalidCredentials',
      values: { email: 'leart@example.com' },
    });
  });

  it('maps a suspended account', async () => {
    mockFetch(apiError(403, 'ACCOUNT_SUSPENDED'));
    const res = await signInAction(args(post('/hyr', { email: 'a@b.co', password: 'pw' })));
    expect(res).toMatchObject({ formError: 'auth.errors.suspended' });
  });

  it('rejects a cross-origin post', async () => {
    await expect(
      signInAction(
        args(post('/hyr', { email: 'a@b.co', password: 'x' }, { Origin: 'https://evil.example' })),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('loader redirects a signed-in reader to returnTo', async () => {
    const session = await getSession(new Request(ORIGIN));
    session.set('token', 't');
    session.set('user', { id: 'u1', email: 'a@b.co', displayName: 'A' });
    const cookie = (await commitSession(session)).split(';')[0] as string;
    const thrown = await Promise.resolve(
      signInLoader(
        args(new Request(`${ORIGIN}/hyr?returnTo=%2Flista`, { headers: { Cookie: cookie } })),
      ),
    ).catch((e) => e);
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get('Location')).toBe('/lista');
    const guest = await signInLoader(args(new Request(`${ORIGIN}/hyr`)));
    expect(guest).toBeNull();
  });
});

describe('sign-in session hygiene', () => {
  it('sends no bearer token and clears an earlier reader checkouts', async () => {
    const old = await getSession(new Request(ORIGIN));
    old.set('token', 'old-token');
    old.set('checkouts', { b1: { transactionId: 't', idempotencyKey: 'k' } });
    const cookie = (await commitSession(old)).split(';')[0] as string;
    const fetchMock = mockFetch(json(200, apiUser('reader')));
    const res = (await signInAction(
      args(post('/hyr', { email: 'a@b.co', password: 'pw' }, { Cookie: cookie })),
    )) as Response;
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBeNull();
    const session = await sessionOf(res);
    expect(session.get('checkouts')).toBeUndefined();
    expect(session.get('token')).toBe('secret-token');
  });

  it('ignores prototype keys in validation details', async () => {
    mockFetch(apiError(400, 'VALIDATION_FAILED', [{ path: 'constructor', message: 'x' }]));
    const res = await registerAction(
      args(post('/regjistrohu', { email: 'a@b.co', password: 'p' })),
    );
    expect(res).toMatchObject({ formError: 'auth.errors.generic' });
  });
});

describe('register action', () => {
  it('posts email, password and displayName, then signs in', async () => {
    const fetchMock = mockFetch(json(201, apiUser('reader')));
    const res = (await registerAction(
      args(
        post('/regjistrohu', {
          email: 'leart@example.com',
          password: 'long-enough-pw',
          displayName: 'Leart',
          returnTo: '/pagesa',
        }),
      ),
    )) as Response;
    expect(res.headers.get('Location')).toBe('/pagesa');
    expect((await sessionOf(res)).get('token')).toBe('secret-token');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: 'leart@example.com',
      password: 'long-enough-pw',
      displayName: 'Leart',
    });
  });

  it('shows API field errors and keeps the values', async () => {
    mockFetch(apiError(400, 'VALIDATION_FAILED', [{ path: 'password', message: 'too short' }]));
    const res = await registerAction(
      args(post('/regjistrohu', { email: 'a@b.co', password: 'short', displayName: 'Ana' })),
    );
    expect(res).toMatchObject({
      fieldErrors: { password: 'auth.errors.password' },
      values: { email: 'a@b.co', displayName: 'Ana' },
    });
  });

  it('maps a taken email to an email field error', async () => {
    mockFetch(apiError(409, 'EMAIL_TAKEN'));
    const res = await registerAction(
      args(post('/regjistrohu', { email: 'a@b.co', password: 'long-enough-pw' })),
    );
    expect(res).toMatchObject({ fieldErrors: { email: 'auth.errors.emailTaken' } });
  });

  it('loader redirects a signed-in reader and lets a guest through', async () => {
    const session = await getSession(new Request(ORIGIN));
    session.set('user', { id: 'u1', email: 'a@b.co', displayName: 'A' });
    const cookie = (await commitSession(session)).split(';')[0] as string;
    const thrown = await Promise.resolve(
      registerLoader(
        args(
          new Request(`${ORIGIN}/regjistrohu?returnTo=%2Flista`, { headers: { Cookie: cookie } }),
        ),
      ),
    ).catch((e) => e);
    expect(thrown.status).toBe(302);
    expect(thrown.headers.get('Location')).toBe('/lista');
    expect(await registerLoader(args(new Request(`${ORIGIN}/regjistrohu`)))).toBeNull();
  });
});

describe('sign-out action', () => {
  it('destroys the session and redirects home', async () => {
    const res = (await signOutAction(args(post('/dil', {})))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(res.headers.get('Set-Cookie')).toContain('libraria_session=');
    await expect(
      signOutAction(args(post('/dil', {}, { Origin: 'https://evil.example' }))),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('GET /dil redirects home without touching the session', () => {
    const res = signOutLoader();
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/');
    expect(res.headers.get('Set-Cookie')).toBeNull();
  });
});

function renderPage(Component: () => React.ReactNode, path: string, actionResult?: unknown) {
  const Stub = createRoutesStub([
    {
      path: path.split('?')[0],
      Component,
      action: actionResult === undefined ? undefined : () => actionResult,
    },
  ]);
  return render(
    <I18nextProvider i18n={createI18n('sq')}>
      <Stub initialEntries={[path]} />
    </I18nextProvider>,
  );
}

describe('auth pages', () => {
  it('sign-in page renders, carries returnTo, and shows a form error with the email kept', async () => {
    const { container } = renderPage(SignIn, '/hyr?returnTo=%2Flista', {
      formError: 'auth.errors.invalidCredentials',
      values: { email: 'leart@example.com' },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Hyr' })).toBeInTheDocument();
    expect(container.querySelector('input[name="returnTo"]')).toHaveValue('/lista');
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Hyr' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Email-i ose fjalëkalimi nuk është i saktë.',
    );
    expect(screen.getByLabelText('Email')).toHaveValue('leart@example.com');
  });

  it('sign-in page shows the portal message with a link', async () => {
    renderPage(SignIn, '/hyr', {
      portal: true,
      portalUrl: 'http://portal.test',
      values: { email: 'a@b.co' },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Hyr' }));
    await waitFor(() =>
      expect(screen.getByText(/Ky është një llogari botuesi/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /portal/i })).toHaveAttribute(
      'href',
      'http://portal.test',
    );
  });

  it('register page shows API field errors next to their fields and passes axe', async () => {
    const { container } = renderPage(Register, '/regjistrohu', {
      fieldErrors: { email: 'auth.errors.emailTaken' },
      values: { email: 'a@b.co', displayName: 'Ana' },
    });
    expect(await screen.findByText('Të paktën 10 karaktere.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Regjistrohu' }));
    const email = await screen.findByLabelText('Email');
    expect(email).toHaveAccessibleDescription('Ky email është i regjistruar tashmë.');
    expect(email).toHaveValue('a@b.co');
    expect(screen.getByLabelText('Emri')).toHaveValue('Ana');
    expect(await axe(container)).toHaveNoViolations();
  });
});
