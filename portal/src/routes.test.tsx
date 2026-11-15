import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import AppRoutes from './AppRoutes';
import i18n from './i18n';

vi.mock('./auth/RequireAuth', async () => {
  const { Outlet } = await import('react-router-dom');
  return { default: () => <Outlet /> };
});
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
