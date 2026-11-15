import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSummary } from '../api/reports';
import i18n from '../i18n';
import { useDateRange } from '../lib/useDateRange';
import AppShell from './AppShell';
import { usesDateRange } from './navItems';

const auth = vi.hoisted(() => ({
  value: {
    status: 'authenticated',
    user: {} as Record<string, unknown>,
    accessDenied: false,
    expired: false,
    login: async () => undefined,
    logout: vi.fn(async () => undefined),
  },
}));

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => auth.value }));

const publisherUser = {
  id: 'u1',
  email: 'pub@example.com',
  displayName: 'Ada Publisher',
  role: 'publisher',
  publisherId: 'p1',
  createdAt: '2026-01-01T00:00:00Z',
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

function Probe() {
  const { range } = useDateRange();
  const location = useLocation();
  useSummary(range, 'day');
  return <p data-testid="search">{location.search}</p>;
}

function renderShell(path = '/') {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<Probe />} />
              <Route path="sales" element={<Probe />} />
              <Route path="catalog" element={<p>catalog page</p>} />
              <Route path="catalog/:bookId/*" element={<p>book page</p>} />
              <Route path="settings" element={<p>settings page</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes('/admin/publishers')) {
      return json({
        publishers: [
          { id: 'pa', name: 'Alpha Press' },
          { id: 'pb', name: 'Beta Books' },
        ],
      });
    }
    return json({ totals: {}, series: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    localStorage.clear();
  } catch {
    // Storage unavailable in this environment.
  }
  auth.value.user = publisherUser;
  await i18n.changeLanguage('en');
});

describe('sidebar', () => {
  it('shows the three groups and their links in English', () => {
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Workspace', 'Financials', 'Organization']) {
      expect(within(nav).getByRole('heading', { name: label })).toBeInTheDocument();
    }
    for (const label of [
      'Overview',
      'Catalog',
      'Sales & Orders',
      'Analytics',
      'Earnings',
      'Transactions',
      'Payouts',
      'Statements',
      'Contracts',
      'Settings',
    ]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
  });

  it('shows the groups in Albanian', async () => {
    await i18n.changeLanguage('sq');
    renderShell();
    const nav = screen.getByRole('navigation', { name: 'Navigimi kryesor' });
    for (const label of ['Hapësira e punës', 'Financat', 'Organizata']) {
      expect(within(nav).getByRole('heading', { name: label })).toBeInTheDocument();
    }
  });

  it('marks only the active route with aria-current="page"', () => {
    renderShell('/sales');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Sales & Orders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('collapses on desktop and remembers it', async () => {
    const user = userEvent.setup();
    const first = renderShell();
    const toggle = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(localStorage.getItem('libraria.portal.sidebarCollapsed')).toBe('1');
    first.unmount();
    renderShell();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('opens the drawer from the menu button and closes it with Escape, returning focus', async () => {
    const user = userEvent.setup();
    renderShell();
    const open = screen.getByRole('button', { name: 'Open menu' });
    await user.click(open);
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(drawer).getByRole('link', { name: 'Catalog' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(open).toHaveFocus();
  });

  it('closes the drawer after choosing a link', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation' });
    await user.click(within(drawer).getByRole('link', { name: 'Catalog' }));
    expect(await screen.findByText('catalog page')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('range in navigation', () => {
  it('carries the chosen range through sidebar links to range pages only', async () => {
    const user = userEvent.setup();
    renderShell('/?from=2026-01-01&to=2026-02-01');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    await user.click(within(nav).getByRole('link', { name: 'Sales & Orders' }));
    await waitFor(() =>
      expect(screen.getByTestId('search')).toHaveTextContent('?from=2026-01-01&to=2026-02-01'),
    );
    expect(
      fetchMock.mock.calls.some(
        ([u]) => /reports\/summary/.test(String(u)) && String(u).includes('from=2026-01-01'),
      ),
    ).toBe(true);
    expect(within(nav).getByRole('link', { name: 'Sales & Orders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Catalog' })).toHaveAttribute('href', '/catalog');
    expect(within(nav).getByRole('link', { name: 'Earnings' })).toHaveAttribute(
      'href',
      '/earnings?from=2026-01-01&to=2026-02-01',
    );
  });

  it('rewrites a bad range in the URL once, in the shell', async () => {
    renderShell('/sales?from=abc&to=def');
    await waitFor(() => expect(screen.getByTestId('search').textContent).toMatch(/^\?from=\d{4}/));
  });
});

describe('top bar', () => {
  it('shows the date range on range pages only', () => {
    const first = renderShell('/sales');
    expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument();
    first.unmount();
    renderShell('/catalog');
    expect(screen.queryByRole('group', { name: 'Period' })).not.toBeInTheDocument();
  });

  it("shows the date range on a book's Sales and Analytics tabs only", () => {
    expect(usesDateRange('/catalog/b1/sales')).toBe(true);
    expect(usesDateRange('/catalog/b1/analytics')).toBe(true);
    expect(usesDateRange('/catalog/b1')).toBe(false);
    expect(usesDateRange('/catalog/b1/files')).toBe(false);
    expect(usesDateRange('/catalog')).toBe(false);
  });

  it('shows the user and signs out from the user menu', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: /Ada Publisher/ }));
    expect(await screen.findByText('pub@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.value.logout).toHaveBeenCalled();
  });
});

describe('top bar contents', () => {
  it('has no page name and no language switch outside the user menu', () => {
    renderShell('/sales');
    const header = screen.getByRole('banner');
    expect(within(header).queryByText('Sales & Orders')).not.toBeInTheDocument();
    expect(header.querySelector('[class*="context"]')).toBeNull();
    expect(document.querySelector('[class*="context"]')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();
  });

  it('switches language from the user menu', async () => {
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: /Ada Publisher/ }));
    const group = await screen.findByRole('group', { name: 'Language' });
    expect(within(group).getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(within(group).getByRole('button', { name: 'Shqip' }));
    await waitFor(() => expect(i18n.language).toBe('sq'));
    expect(
      within(await screen.findByRole('group', { name: 'Gjuha' })).getByRole('button', {
        name: 'Shqip',
      }),
    ).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('admin publisher switching', () => {
  it('puts the publisher picker in the sidebar, not the top bar', async () => {
    auth.value.user = { ...publisherUser, role: 'admin', publisherId: null };
    renderShell('/sales');
    const picker = await screen.findByRole('combobox', { name: 'Publisher' });
    const aside = screen.getByRole('complementary');
    expect(aside).toContainElement(picker);
    expect(within(screen.getByRole('banner')).queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('refetches for the new publisher and keeps the URL range', async () => {
    auth.value.user = {
      id: 'a1',
      email: 'admin@example.com',
      displayName: null,
      role: 'admin',
      publisherId: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const user = userEvent.setup();
    renderShell('/sales?from=2026-01-01&to=2026-02-01');
    const picker = await screen.findByRole('combobox', { name: 'Publisher' });
    await screen.findByRole('option', { name: 'Alpha Press' });

    await user.selectOptions(picker, 'pa');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => /reports\/summary.*publisherId=pa/.test(String(u))),
      ).toBe(true),
    );
    await user.selectOptions(picker, 'pb');
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => /reports\/summary.*publisherId=pb/.test(String(u))),
      ).toBe(true),
    );
    const urls = fetchMock.mock.calls
      .map(([u]) => String(u))
      .filter((u) => u.includes('/reports/summary'));
    expect(urls.every((u) => u.includes('from=2026-01-01') && u.includes('to=2026-02-01'))).toBe(
      true,
    );
    expect(screen.getByTestId('search')).toHaveTextContent('?from=2026-01-01&to=2026-02-01');
  });

  it.each(['/catalog/b1', '/catalog/b1/edit', '/catalog/b1/sales'])(
    'returns to the catalogue when the publisher changes on %s',
    async (path) => {
      auth.value.user = { ...publisherUser, role: 'admin', publisherId: null };
      const user = userEvent.setup();
      renderShell(path);
      const picker = await screen.findByRole('combobox', { name: 'Publisher' });
      await screen.findByRole('option', { name: 'Alpha Press' });
      expect(screen.queryByText('catalog page')).not.toBeInTheDocument();
      await user.selectOptions(picker, 'pa');
      expect(await screen.findByText('catalog page')).toBeInTheDocument();
      expect(screen.queryByText('book page')).not.toBeInTheDocument();
    },
  );
});
