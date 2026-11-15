import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import i18n from '../i18n';
import ContractsPage from './ContractsPage';
import SettingsPage from './SettingsPage';

expect.extend(axeMatchers);
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const scope = vi.hoisted(() => ({
  value: {
    publisherId: undefined as string | undefined,
    setPublisherId: () => undefined,
    isAdmin: false,
    publishers: [] as Array<{ id: string; name: string }>,
  },
}));
vi.mock('../layout/PublisherScope', () => ({ usePublisherScope: () => scope.value }));

const auth = vi.hoisted(() => ({
  logout: vi.fn(),
  user: {
    id: 'u1',
    email: 'ana@botuesi.example',
    displayName: 'Ana Botuesi' as string | null,
    role: 'publisher_staff',
    publisherId: 'p1',
    createdAt: '2026-01-01T00:00:00Z',
  },
}));
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: auth.user, logout: auth.logout }),
}));

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();
let contract: unknown;

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/contracts" element={<ContractsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const active = {
  id: 'c2',
  rateBps: 2000,
  effectiveFrom: '2026-01-01T00:00:00Z',
  contractReference: 'REF-42',
  inForce: true,
  status: 'active',
};
const scheduled = {
  id: 'c3',
  rateBps: 1500,
  effectiveFrom: '2099-01-01T00:00:00Z',
  contractReference: null,
  inForce: false,
  status: 'scheduled',
};
const superseded = {
  id: 'c1',
  rateBps: 2500,
  effectiveFrom: '2025-01-01T00:00:00Z',
  contractReference: 'REF-1',
  inForce: false,
  status: 'superseded',
};

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  auth.logout.mockReset();
  auth.user.displayName = 'Ana Botuesi';
  contract = {
    publisherId: 'p1',
    current: active,
    history: [scheduled, active, superseded],
  };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    String(url).includes('/publisher/contract')
      ? json(200, contract)
      : json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Contracts page', () => {
  it('shows the current rate as a percentage with its reference and status', async () => {
    renderAt('/contracts');
    const current = await screen.findByRole('region', { name: 'Current contract' });
    expect(within(current).getByText('20%')).toBeInTheDocument();
    expect(within(current).getByText('REF-42')).toBeInTheDocument();
    expect(within(current).getByText('Active')).toBeInTheDocument();
  });

  it('renders the server status of every history row as a text badge', async () => {
    renderAt('/contracts');
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row').slice(1) as HTMLElement[];
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Scheduled')).toBeInTheDocument();
    expect(within(rows[0]).getByText('15%')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Active')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Superseded')).toBeInTheDocument();
    // A missing reference shows a dash, never a blank.
    expect(within(rows[0]).getByText('—')).toBeInTheDocument();
  });

  it('shows the no-contract message and no table when there is nothing', async () => {
    contract = { publisherId: 'p1', current: null, history: [] };
    renderAt('/contracts');
    expect(await screen.findByText(/No active contract/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('still lists the history when only a future contract exists', async () => {
    contract = { publisherId: 'p1', current: null, history: [scheduled] };
    renderAt('/contracts');
    expect(await screen.findByText(/No active contract/)).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
  });

  it('asks an admin to pick a publisher first and makes no request', () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: undefined };
    renderAt('/contracts');
    expect(screen.getByText('No publisher selected')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers a retry when the contract cannot be loaded', async () => {
    fetchMock.mockImplementation(async () =>
      json(500, { error: { code: 'INTERNAL', message: 'x', requestId: 'r' } }),
    );
    renderAt('/contracts');
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAt('/contracts');
    await screen.findByRole('table');
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Settings page', () => {
  it('shows the account read only', () => {
    renderAt('/settings');
    const account = screen.getByRole('region', { name: 'Account' });
    expect(within(account).getByText('ana@botuesi.example')).toBeInTheDocument();
    expect(within(account).getByText('Ana Botuesi')).toBeInTheDocument();
    expect(within(account).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows a dash when there is no display name', () => {
    auth.user.displayName = null;
    renderAt('/settings');
    const account = screen.getByRole('region', { name: 'Account' });
    expect(within(account).getByText('—')).toBeInTheDocument();
  });

  it('switches the language live', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(screen.getByRole('button', { name: 'Shqip' }));
    expect(await screen.findByRole('heading', { name: 'Cilësimet' })).toBeInTheDocument();
    expect(i18n.language).toBe('sq');
    await i18n.changeLanguage('en');
  });

  it('signs out through the auth provider', async () => {
    const user = userEvent.setup();
    renderAt('/settings');
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it('links the organization section to the commission contract', () => {
    renderAt('/settings');
    const org = screen.getByRole('region', { name: 'Organization' });
    expect(within(org).getByRole('link', { name: /Commission contract/ })).toHaveAttribute(
      'href',
      '/contracts',
    );
  });

  it('lists what is coming later as plain text with no controls', () => {
    renderAt('/settings');
    const later = screen.getByRole('region', { name: 'Coming later' });
    const items = within(later).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    for (const name of ['Team and roles', 'Payment settings', 'Profile and storefront']) {
      expect(within(later).getByText(name)).toBeInTheDocument();
    }
    expect(later.querySelector('input, button, select, textarea, a')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const { container } = renderAt('/settings');
    expect(await axe(container)).toHaveNoViolations();
  });
});
