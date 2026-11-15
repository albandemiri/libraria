import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AppRoutes from './AppRoutes';
import i18n from './i18n';

const guard = vi.hoisted(() => ({ renders: 0, role: 'admin' }));
vi.mock('./auth/RequireAuth', async () => {
  const { Outlet } = await import('react-router-dom');
  return {
    default: () => {
      guard.renders += 1;
      return <Outlet />;
    },
  };
});
vi.mock('./auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1', role: guard.role }, status: 'authenticated' }),
}));
vi.mock('./pages/InvitePage', () => ({ default: () => <p>invite page</p> }));
vi.mock('./pages/platform/PlatformOverviewPage', () => ({
  default: () => <p>platform overview page</p>,
}));
vi.mock('./pages/platform/PublishersPage', () => ({ default: () => <p>publishers page</p> }));
vi.mock('./pages/platform/PublisherPage', () => ({ default: () => <p>publisher detail page</p> }));
vi.mock('./pages/platform/PlatformBooksPage', () => ({
  default: () => <p>platform books page</p>,
}));
vi.mock('./pages/platform/ReadersPage', () => ({ default: () => <p>readers page</p> }));
vi.mock('./pages/platform/ReaderPage', () => ({ default: () => <p>reader detail page</p> }));
vi.mock('./layout/AppShell', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet /> };
});
vi.mock('./pages/CatalogPage', () => ({ default: () => <p>catalog page</p> }));
vi.mock('./pages/BookPage', () => ({ default: () => <p>book page</p> }));
vi.mock('./pages/BookEditorPage', () => ({ default: () => <p>book editor page</p> }));
vi.mock('./pages/ContractsPage', () => ({ default: () => <p>contract page</p> }));
vi.mock('./pages/SettingsPage', () => ({ default: () => <p>settings page</p> }));

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

async function visit(path: string) {
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[path]}>
        <Where />
        <AppRoutes />
      </MemoryRouter>
    </I18nextProvider>,
  );
  // Wait for the lazy page to settle.
  await screen.findByText(/page$/);
  return screen.getByTestId('where').textContent;
}

describe('old routes redirect to the new ones', () => {
  it.each([
    ['/books', '/catalog'],
    ['/books/new', '/catalog/new'],
    ['/books/b1', '/catalog/b1'],
    ['/contract', '/contracts'],
  ])('%s -> %s', async (from, to) => {
    expect(await visit(from)).toBe(to);
  });
});

describe('catalogue routes open the real pages', () => {
  it.each([
    ['/catalog', 'catalog page'],
    ['/catalog/new', 'book editor page'],
    ['/catalog/b1', 'book page'],
    ['/catalog/b1/files', 'book page'],
    ['/catalog/b1/edit', 'book editor page'],
    ['/contracts', 'contract page'],
    ['/settings', 'settings page'],
  ])('%s shows %s without redirecting', async (path, text) => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <AppRoutes />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(path);
  });
});

describe('Platform routes are for admins only', () => {
  function open(path: string) {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <AppRoutes />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it.each([
    ['/platform', 'platform overview page'],
    ['/platform/publishers', 'publishers page'],
    ['/platform/publishers/p1', 'publisher detail page'],
    ['/platform/books', 'platform books page'],
    ['/platform/readers', 'readers page'],
    ['/platform/readers/r1', 'reader detail page'],
  ])('%s opens for an admin', async (path, text) => {
    guard.role = 'admin';
    open(path);
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(path);
  });

  it.each([
    '/platform',
    '/platform/publishers',
    '/platform/publishers/p1',
    '/platform/books',
    '/platform/readers',
    '/platform/readers/r1',
    '/platform/anything',
  ])('%s is "not found" for a publisher', async (path) => {
    guard.role = 'publisher';
    open(path);
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(
      screen.queryByText(
        /platform overview page|publishers page|publisher detail page|platform books page|readers page|reader detail page/,
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(path);
  });

  it('an unknown Platform page is "not found" even for an admin', async () => {
    guard.role = 'admin';
    open('/platform/nothing-here');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});

describe('the invite page is public', () => {
  it('/invite opens outside the sign-in guard', async () => {
    guard.renders = 0;
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/invite']}>
          <AppRoutes />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(await screen.findByText('invite page')).toBeInTheDocument();
    expect(guard.renders).toBe(0);
  });
});
