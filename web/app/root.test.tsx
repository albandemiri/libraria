import { render, screen, within } from '@testing-library/react';
import { createRoutesStub } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import Discover from './routes/discover';
import NotFound, { loader as notFoundLoader } from './routes/not-found';
import App, { ErrorBoundary, Layout } from './root';

function RootRoute() {
  return (
    <Layout>
      <App />
    </Layout>
  );
}

function RootError() {
  return (
    <Layout>
      <ErrorBoundary />
    </Layout>
  );
}

function Boom(): never {
  throw new Error('render failed');
}

/** The real route tree's shape: a root with an error boundary and a `*` catch-all. */
function stubWithErrors(lang: 'sq' | 'en', rootLoader?: () => unknown) {
  return createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: rootLoader ?? (() => ({ lang, user: null, portalUrl: 'http://portal.test' })),
      Component: RootRoute,
      ErrorBoundary: RootError,
      children: [
        { index: true, Component: Discover },
        { path: 'boom', Component: Boom },
        { path: '*', loader: notFoundLoader, Component: NotFound },
      ],
    },
  ]);
}

function stubWithLang(lang: 'sq' | 'en') {
  return createRoutesStub([
    {
      id: 'root',
      path: '/',
      loader: () => ({ lang, user: null }),
      Component: RootRoute,
      children: [{ index: true, Component: Discover }],
    },
  ]);
}

describe('root', () => {
  it('root renders html lang from the loader', async () => {
    const Stub = stubWithLang('en');
    render(<Stub initialEntries={['/']} />);
    await screen.findByRole('heading', { level: 1 });
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('translates with the loader language', async () => {
    const Stub = stubWithLang('sq');
    render(<Stub initialEntries={['/']} />);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Zbulo');
    expect(document.documentElement).toHaveAttribute('lang', 'sq');
  });
});

describe('root error boundary', () => {
  it.each([
    ['sq', '/nope', 'Faqja nuk u gjet', 'Kthehu te Eksploro'],
    ['en', '/libri', 'Page not found', 'Back to Explore'],
  ] as const)(
    'an unknown URL (%s, %s) is a 404 inside the site shell',
    async (lang, path, title, back) => {
      const Stub = stubWithErrors(lang);
      render(<Stub initialEntries={[path]} />);
      expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: back })).toHaveAttribute('href', '/eksploro');
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('contentinfo')).toBeInTheDocument();
      expect(within(screen.getByRole('main')).getByText(title)).toBeInTheDocument();
      expect(document.documentElement).toHaveAttribute('lang', lang);
    },
  );

  it('a route without its own boundary fails inside the shell', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Stub = stubWithErrors('en');
    render(<Stub initialEntries={['/boom']} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Back to Explore' })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    log.mockRestore();
  });

  it('renders the shell as a guest when the root loader itself failed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Stub = stubWithErrors('sq', () => {
      throw new Error('session store down');
    });
    render(<Stub initialEntries={['/']} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Hyr' })).toBeInTheDocument();
    log.mockRestore();
  });

  it('the catch-all loader throws a 404 response', () => {
    expect(() => notFoundLoader()).toThrow(expect.objectContaining({ status: 404 }));
  });
});
