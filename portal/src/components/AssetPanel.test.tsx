import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import AssetPanel from './AssetPanel';

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

function asset(over: Record<string, unknown>) {
  return {
    id: 'a1',
    version: 1,
    state: 'ready',
    reasonCode: null,
    reasonDetail: null,
    originalSizeBytes: 1000,
    isCurrent: false,
    createdAt: '2026-11-01T00:00:00Z',
    readyAt: '2026-11-01T00:01:00Z',
    activatedAt: null,
    ...over,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();
let assets: unknown[];

function renderPanel() {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AssetPanel bookId="b1" />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const listCalls = () =>
  fetchMock.mock.calls.filter(
    ([url, init]) => String(url).includes('/books/b1/assets') && !init?.method,
  ).length;

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  assets = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const u = String(url);
    if (method === 'POST' && u.includes('/assets/a1/activate')) {
      return json(200, { asset: asset({ isCurrent: true }) });
    }
    if (method === 'POST' && u.includes('/books/b1/assets')) {
      return json(202, { asset: asset({ id: 'a2', version: 2, state: 'uploaded' }) });
    }
    if (u.includes('/books/b1/assets')) return json(200, { assets });
    return json(404, { error: { code: 'NOT_FOUND', message: 'x', requestId: 'r' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('AssetPanel', () => {
  it('uploads the raw file with the EPUB content type', async () => {
    renderPanel();
    const file = new File(['epub-bytes'], 'book.epub', { type: 'application/epub+zip' });
    await userEvent.upload(await screen.findByLabelText('Upload EPUB'), file);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      const init = post?.[1] as RequestInit;
      expect(new Headers(init.headers).get('Content-Type')).toBe('application/epub+zip');
      expect(init.body).toBe(file);
      expect(init.credentials).toBe('include');
    });
  });

  it('shows a translated reason for a rejected version, never the English detail', async () => {
    assets = [
      asset({
        state: 'rejected',
        reasonCode: 'SCRIPTED_CONTENT',
        reasonDetail: 'English backend detail',
      }),
    ];
    await i18n.changeLanguage('sq');
    renderPanel();
    expect(await screen.findByText(i18n.t('assets.reasons.SCRIPTED_CONTENT'))).toBeInTheDocument();
    expect(i18n.t('assets.reasons.SCRIPTED_CONTENT')).not.toBe('assets.reasons.SCRIPTED_CONTENT');
    expect(screen.queryByText('English backend detail')).not.toBeInTheDocument();
  });

  it('activates a ready version that is not live after confirmation', async () => {
    assets = [asset({})];
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Make this version live' }));
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/activate'))).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, make it live' }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u]) => String(u).includes('/assets/a1/activate'));
      expect(post?.[1]?.method).toBe('POST');
    });
  });

  it('marks the live version and offers no button for it', async () => {
    assets = [asset({ isCurrent: true })];
    renderPanel();
    expect(await screen.findByText('Live')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make this version live' })).toBeNull();
  });

  it('polls while a version is processing and stops once all are terminal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    assets = [asset({ state: 'scanning' })];
    renderPanel();
    await screen.findByText('Scanning');
    const before = listCalls();
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(listCalls()).toBeGreaterThan(before);

    assets = [asset({ state: 'ready' })];
    await act(() => vi.advanceTimersByTimeAsync(3100));
    await screen.findByText('Ready');
    const settled = listCalls();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(listCalls()).toBe(settled);
  });

  it('sends the picked publisher when an admin uploads', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'p9' };
    renderPanel();
    const file = new File(['x'], 'book.epub');
    await userEvent.upload(await screen.findByLabelText('Upload EPUB'), file);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(String(post?.[0])).toContain('publisherId=p9');
    });
  });

  it('translates an upload error', async () => {
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json(413, { error: { code: 'PAYLOAD_TOO_LARGE', message: 'big', requestId: 'r' } })
        : json(200, { assets: [] }),
    );
    renderPanel();
    await userEvent.upload(await screen.findByLabelText('Upload EPUB'), new File(['x'], 'b.epub'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/100 MB/);
  });
});
