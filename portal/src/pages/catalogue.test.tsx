import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { formatMoney } from '../lib/format';
import BookFormPage from './BookFormPage';
import BooksPage from './BooksPage';
import ContractPage from './ContractPage';

const scope = vi.hoisted(() => ({
  value: {
    publisherId: undefined as string | undefined,
    setPublisherId: () => undefined,
    isAdmin: false,
    publishers: [] as Array<{ id: string; name: string }>,
  },
}));

vi.mock('../layout/PublisherScope', () => ({
  usePublisherScope: () => scope.value,
}));

const book = {
  id: 'b1',
  publisherId: 'p1',
  title: 'Draft Novel',
  author: 'A. Author',
  isbn13: null,
  description: null,
  genre: 'Fiction',
  language: 'en',
  price: { amountCents: 1299, currency: 'EUR' },
  coverImageUrl: null,
  publishedAt: null,
  isAvailable: false,
  mediaType: 'ebook',
  durationSeconds: null,
  hasAsset: false,
  fileSizeBytes: null,
  metrics: { salesCount: 7, totalRevenueCents: 90_000, earningsCents: 34_567 },
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();
let contract: unknown;

function route(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET';
  if (url.includes('/publisher/contract')) return json(200, contract);
  if (/\/books\/b1\/publish/.test(url)) {
    return json(400, { error: { code: 'ASSET_REQUIRED', message: 'x', requestId: 'r' } });
  }
  if (/\/books\/b1/.test(url) && method === 'GET') return json(200, { book });
  if (/\/books\/b1/.test(url) && method === 'PATCH') {
    return json(400, {
      error: {
        code: 'VALIDATION_FAILED',
        message: 'x',
        requestId: 'r',
        details: [{ path: 'isbn13', message: 'ISBN-13 must be exactly 13 numeric digits' }],
      },
    });
  }
  if (url.includes('/publisher/books')) {
    return json(200, {
      books: [book],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } });
}

function renderAt(path: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/books" element={<BooksPage />} />
            <Route path="/books/new" element={<BookFormPage />} />
            <Route path="/books/:id" element={<BookFormPage />} />
            <Route path="/contract" element={<ContractPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const currentContract = {
  id: 'c1',
  rateBps: 2000,
  effectiveFrom: '2026-01-01T00:00:00Z',
  contractReference: 'REF-42',
  inForce: true,
};

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  contract = { publisherId: 'p1', current: currentContract, history: [currentContract] };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => route(String(url), init));
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BooksPage', () => {
  it('shows each book with its copies and earnings from the backend', async () => {
    renderAt('/books');
    expect(await screen.findByText('Draft Novel')).toBeInTheDocument();
    expect(screen.getByText(formatMoney(34_567, 'en'))).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Draft' })).toBeInTheDocument();
  });

  it('asks an admin to pick a publisher first', () => {
    scope.value = { ...scope.value, isAdmin: true };
    renderAt('/books');
    expect(screen.getByText('Choose a publisher above to see its data.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('BookFormPage', () => {
  it('explains that file upload is coming when publishing without a file', async () => {
    const user = userEvent.setup();
    renderAt('/books/b1');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/File upload is coming soon/)).toBeInTheDocument();
  });

  it('shows validation details next to their field', async () => {
    const user = userEvent.setup();
    renderAt('/books/b1');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('ISBN-13 must be 13 digits, with no hyphens.'),
    ).toBeInTheDocument();
    // The backend's English wording is never shown.
    expect(screen.queryByText(/must be exactly/)).not.toBeInTheDocument();
  });

  it('shows the Albanian field message, not the backend English', async () => {
    await i18n.changeLanguage('sq');
    const user = userEvent.setup();
    renderAt('/books/b1');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Ruaj' }));
    expect(
      await screen.findByText('ISBN-13 duhet të ketë 13 shifra, pa viza.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/must be exactly/)).not.toBeInTheDocument();
  });

  it('sends null for cleared optional fields so the server clears them', async () => {
    const user = userEvent.setup();
    renderAt('/books/b1');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText(/ISBN-13 must be 13 digits/);
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body.isbn13).toBeNull();
    expect(body.description).toBeNull();
    expect(body.coverImageUrl).toBeNull();
    expect(body.durationSeconds).toBeNull();
  });

  it('sends the admin publisherId in the query for writes', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'p1' };
    const user = userEvent.setup();
    renderAt('/books/b1');
    await screen.findByDisplayValue('Draft Novel');
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('/books/b1/publish?publisherId=p1')),
      ).toBe(true),
    );
  });
});

describe('ContractPage', () => {
  it('shows the current rate as a percentage with its reference', async () => {
    renderAt('/contract');
    expect((await screen.findAllByText('20%')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('REF-42').length).toBeGreaterThan(0);
  });

  it('shows the no-contract message', async () => {
    contract = { publisherId: 'p1', current: null, history: [] };
    renderAt('/contract');
    expect(await screen.findByText(/No active contract/)).toBeInTheDocument();
  });
});
