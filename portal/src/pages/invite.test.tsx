import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Fragment, StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import i18n from '../i18n';
import InvitePage from './InvitePage';

expect.extend(axeMatchers);
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const TOKEN = 'tok_Abc-123_defGHI456jklMNO789pqrSTU0123456789';

const publisherUser = {
  id: 'u9',
  email: 'beni@drita.example',
  displayName: 'Beni Drita',
  role: 'publisher',
  publisherId: 'p1',
  createdAt: '2026-03-01T00:00:00Z',
};

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let inspect: () => Response;
let accept: () => Response;
const replaceState = vi.spyOn(window.history, 'replaceState');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const err = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: 'x', requestId: 'r', details } });
const info = (over: Record<string, unknown> = {}) =>
  json(200, {
    email: 'beni@drita.example',
    publisherName: 'Botimet Drita',
    displayName: 'Beni',
    emailTaken: false,
    ...over,
  });

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = String(input);
  calls.push({
    method: init?.method ?? 'GET',
    url,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  });
  if (url.endsWith('/auth/me')) return err(401, 'UNAUTHORIZED');
  if (url.endsWith('/auth/invites/inspect')) return inspect();
  if (url.endsWith('/auth/invites/accept')) return accept();
  return err(404, 'NOT_FOUND');
});

function Home() {
  const { user, status } = useAuth();
  return (
    <p>
      home {status} {user?.email}
    </p>
  );
}

function renderInvite(hash: string | null = `#token=${TOKEN}`, search = '', strict = false) {
  window.history.replaceState(null, '', `/invite${search}${hash ?? ''}`);
  replaceState.mockClear();
  const Wrap = strict ? StrictMode : Fragment;
  return render(
    <Wrap>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/invite']}>
            <AuthProvider>
              <Routes>
                <Route path="/invite" element={<InvitePage />} />
                <Route path="/" element={<Home />} />
              </Routes>
            </AuthProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>
    </Wrap>,
  );
}

const call = (suffix: string) => calls.filter((c) => c.url.endsWith(suffix));

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  password = 'Password123!',
  confirm = password,
) {
  const name = await screen.findByLabelText(/Your name/);
  await user.clear(name);
  await user.type(name, 'Beni Drita');
  await user.type(screen.getByLabelText(/^New password/), password);
  await user.type(screen.getByLabelText(/Confirm password/), confirm);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

beforeEach(async () => {
  calls = [];
  inspect = () => info();
  accept = () => json(200, { user: publisherUser });
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('token handling', () => {
  it('reads the token from the fragment, then clears the fragment from the URL', async () => {
    renderInvite();
    await screen.findByText(/Botimet Drita/);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(replaceState).toHaveBeenCalled();
    for (const args of replaceState.mock.calls) expect(String(args[2])).not.toContain(TOKEN);
    expect(call('/auth/invites/inspect')[0].body).toEqual({ token: TOKEN });
  });

  it('never puts the token in a request URL, storage or the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user);
    await screen.findByText(/home authenticated/);
    for (const c of calls) expect(c.url).not.toContain(TOKEN);
    expect(call('/auth/invites/accept')).toHaveLength(1);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
      spy.mockRestore();
    }
  });

  it('still reads the token when React runs its effects twice (Strict Mode)', async () => {
    renderInvite(`#token=${TOKEN}`, '', true);
    expect(await screen.findByText(/Botimet Drita/)).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(
      call('/auth/invites/inspect').every((c) => (c.body as { token: string }).token === TOKEN),
    ).toBe(true);
  });

  it('ignores a token in the query string', async () => {
    renderInvite(null, `?token=${TOKEN}`);
    expect(
      await screen.findByText(/link is incomplete or was not copied in full/),
    ).toBeInTheDocument();
    expect(call('/auth/invites/inspect')).toHaveLength(0);
  });

  it('says the link is incomplete when there is no token, and asks nothing of the API', async () => {
    renderInvite(null);
    expect(
      await screen.findByText(/link is incomplete or was not copied in full/),
    ).toBeInTheDocument();
    expect(call('/auth/invites/inspect')).toHaveLength(0);
  });
});

describe('invite page', () => {
  it('shows the publisher and the fixed email, and prefills the name', async () => {
    renderInvite();
    expect(await screen.findByText(/Botimet Drita/)).toBeInTheDocument();
    expect(screen.getByText('beni@drita.example')).toBeInTheDocument();
    expect(screen.getByLabelText(/Your name/)).toHaveValue('Beni');
    expect(screen.queryByRole('textbox', { name: /Email/ })).not.toBeInTheDocument();
  });

  it('warns that the email is taken, before any password field', async () => {
    inspect = () => info({ emailTaken: true });
    renderInvite();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/already has an account/);
    expect(alert).toHaveTextContent(/another email/i);
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
    expect(call('/auth/invites/accept')).toHaveLength(0);
  });

  it('refuses a mismatched password confirmation and sends nothing', async () => {
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user, 'Password123!', 'Password999!');
    expect(await screen.findByText('The two passwords do not match')).toBeInTheDocument();
    expect(call('/auth/invites/accept')).toHaveLength(0);
  });

  it('refuses a short password and sends nothing', async () => {
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user, 'short');
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(call('/auth/invites/accept')).toHaveLength(0);
  });

  it('accepts, signs in through the cookie session and goes to the portal home', async () => {
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user);
    expect(await screen.findByText('home authenticated beni@drita.example')).toBeInTheDocument();
    expect(call('/auth/invites/accept')[0].body).toEqual({
      token: TOKEN,
      password: 'Password123!',
      displayName: 'Beni Drita',
    });
  });

  it.each([
    ['expired', /This invite link has expired/],
    ['used', /This invite link has already been used/],
    ['revoked', /This invite was cancelled/],
    ['unknown', /This invite link is not valid/],
  ])('shows its own message for a %s invite', async (reason, message) => {
    inspect = () => err(410, 'INVITE_INVALID', { reason });
    renderInvite();
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it('shows the reason too when the invite dies between opening and accepting', async () => {
    accept = () => err(410, 'INVITE_INVALID', { reason: 'used' });
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user);
    expect(await screen.findByText(/This invite link has already been used/)).toBeInTheDocument();
  });

  it('explains EMAIL_TAKEN at accept time', async () => {
    accept = () => err(409, 'EMAIL_TAKEN');
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user);
    expect(await screen.findByText(/already has an account/)).toBeInTheDocument();
    expect(screen.getByText(/another email/i)).toBeInTheDocument();
  });

  it.each([
    ['RATE_LIMITED', /Too many attempts/],
    ['VALIDATION_FAILED', /Check the details and try again/],
    ['SOMETHING_NEW', /Something went wrong/],
  ])('maps the %s error code to text', async (code, message) => {
    accept = () => err(code === 'RATE_LIMITED' ? 429 : 400, code);
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    // The form stays, so the person can try again.
    expect(screen.getByLabelText(/^New password/)).toBeInTheDocument();
  });

  it('shows a retry when the invite cannot be checked at all', async () => {
    inspect = () => err(500, 'INTERNAL');
    renderInvite();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('has the same words in Albanian', async () => {
    await i18n.changeLanguage('sq');
    inspect = () => err(410, 'INVITE_INVALID', { reason: 'revoked' });
    renderInvite();
    expect(await screen.findByText(/Kjo ftesë u anulua/)).toBeInTheDocument();
    await i18n.changeLanguage('en');
  });

  it('has no accessibility violations on the form, the warning and the refusal', async () => {
    const form = renderInvite();
    await screen.findByLabelText(/^New password/);
    expect(await axe(form.container)).toHaveNoViolations();
    form.unmount();

    inspect = () => info({ emailTaken: true });
    const taken = renderInvite();
    await screen.findByRole('alert');
    expect(await axe(taken.container)).toHaveNoViolations();
    taken.unmount();

    inspect = () => err(410, 'INVITE_INVALID', { reason: 'expired' });
    const gone = renderInvite();
    await screen.findByText(/has expired/);
    await waitFor(async () => expect(await axe(gone.container)).toHaveNoViolations());
  });
});

describe('invite page, fix round', () => {
  it('offers the sign-in link on the taken card too', async () => {
    inspect = () => info({ emailTaken: true });
    renderInvite();
    await screen.findByRole('alert');
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('offers the sign-in link when EMAIL_TAKEN comes at accept', async () => {
    accept = () => err(409, 'EMAIL_TAKEN');
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user);
    expect(await screen.findByRole('link', { name: 'Go to sign in' })).toBeInTheDocument();
  });

  it('reads a 400 at inspect as an invalid link, with no Retry', async () => {
    inspect = () => err(400, 'VALIDATION_FAILED');
    renderInvite();
    expect(await screen.findByText(/This invite link is not valid/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('says a too-long password is limited in bytes', async () => {
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user, 'é'.repeat(40));
    expect(await screen.findByText(/at most 72 bytes/)).toBeInTheDocument();
    expect(call('/auth/invites/accept')).toHaveLength(0);
  });

  it('moves focus to the first invalid field', async () => {
    const user = userEvent.setup();
    renderInvite();
    await fillAndSubmit(user, 'short');
    await waitFor(() => expect(screen.getByLabelText(/^New password/)).toHaveFocus());
  });
});
