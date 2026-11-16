import { render, screen, within } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { describe, expect, it } from 'vitest';
import { configureAxe } from 'vitest-axe';
import type { Lang } from '../i18n';
import type { SessionUser } from '../lib/types';
import App, { Layout } from '../root';
import ComingSoonRoute from '../routes/coming-soon';

// jsdom cannot compute colours; contrast is checked in the design package.
const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const reader: SessionUser = { id: 'u1', email: 'l@example.com', displayName: 'Leart' };

function Page() {
  return <h1>Page</h1>;
}

function RootRoute() {
  return (
    <Layout>
      <App />
    </Layout>
  );
}

function renderAt(
  path: string,
  { lang = 'sq', user = null }: { lang?: Lang; user?: SessionUser | null } = {},
) {
  const Stub = createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: () => ({ lang, user, portalUrl: 'http://portal.test' }),
      Component: RootRoute,
      children: [
        { index: true, Component: Page },
        { path: 'eksploro/*', Component: Page },
        { path: 'kerko', Component: Page },
        { path: 'libri/:id', Component: Page },
        { path: 'biblioteka', Component: ComingSoonRoute },
        { path: 'lista', Component: ComingSoonRoute },
        { path: 'lexo/:id', Component: ComingSoonRoute },
      ],
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

const primaryNav = () => screen.findByRole('navigation', { name: 'Navigimi kryesor' });

describe('site shell', () => {
  it('header marks the active destination with aria-current', async () => {
    renderAt('/');
    const nav = await primaryNav();
    expect(within(nav).getByRole('link', { name: 'Zbulo' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Eksploro' })).not.toHaveAttribute('aria-current');
  });

  it.each(['/eksploro', '/eksploro/Fiction', '/kerko', '/libri/abc'])(
    'Eksploro is active on %s',
    async (path) => {
      renderAt(path);
      const nav = await primaryNav();
      expect(within(nav).getByRole('link', { name: 'Eksploro' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(within(nav).getByRole('link', { name: 'Zbulo' })).not.toHaveAttribute('aria-current');
    },
  );

  it('account menu shows Hyr for guests, with the current page as returnTo', async () => {
    renderAt('/eksploro/Fiction');
    const link = await screen.findByRole('link', { name: 'Hyr' });
    expect(link).toHaveAttribute('href', '/hyr?returnTo=%2Feksploro%2FFiction');
    expect(screen.queryByRole('button', { name: 'Dil' })).toBeNull();
  });

  it('account menu shows the name and Dil for readers', async () => {
    renderAt('/', { user: reader });
    expect(await screen.findByText('Leart')).toBeInTheDocument();
    const signOut = screen.getByRole('button', { name: 'Dil' });
    const form = signOut.closest('form');
    expect(form).toHaveAttribute('method', 'post');
    expect(form).toHaveAttribute('action', '/dil');
    expect(screen.queryByRole('link', { name: 'Hyr' })).toBeNull();
  });

  it('language switch posts to /gjuha and keeps the path and query', async () => {
    renderAt('/eksploro/Fiction?sort=title&page=2');
    const group = await screen.findByRole('form', { name: 'Gjuha' });
    expect(group).toHaveAttribute('action', '/gjuha');
    expect(group.querySelector('input[name="returnTo"]')).toHaveValue(
      '/eksploro/Fiction?sort=title&page=2',
    );
    expect(within(group).getByRole('button', { name: 'English' })).toHaveAttribute('value', 'en');
    expect(within(group).getByRole('button', { name: 'Shqip' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('mobile nav renders the four destinations with accessible labels', async () => {
    renderAt('/biblioteka');
    const nav = await screen.findByRole('navigation', { name: 'Navigimi i telefonit' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['Zbulo', '/'],
      ['Eksploro', '/eksploro'],
      ['Biblioteka ime', '/biblioteka'],
      ['Listat e leximit', '/lista'],
    ]);
    expect(within(nav).getByRole('link', { name: 'Biblioteka ime' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('renders the search box, the phone search link and the portal link', async () => {
    renderAt('/');
    await primaryNav();
    expect(screen.getByRole('combobox', { name: 'Kërko në Libraria' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Kërko' })).toHaveAttribute('href', '/kerko');
    expect(screen.getByRole('link', { name: 'Portali i botuesve' })).toHaveAttribute(
      'href',
      'http://portal.test',
    );
  });

  it('translates the shell to English', async () => {
    renderAt('/', { lang: 'en', user: reader });
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getByRole('link', { name: 'Reading Lists' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});

describe('coming-soon pages', () => {
  it.each([
    ['/biblioteka', 'Biblioteka ime'],
    ['/lista', 'Listat e leximit'],
    ['/lexo/abc', 'Leximi në shfletues'],
  ])('%s renders the page, sets the title and passes axe', async (path, heading) => {
    const { container } = renderAt(path);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(document.title).toBe(`${heading} · Libraria`);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the reader page links back to the book', async () => {
    renderAt('/lexo/abc');
    expect(await screen.findByRole('link', { name: 'Kthehu te libri' })).toHaveAttribute(
      'href',
      '/libri/abc',
    );
  });
});
