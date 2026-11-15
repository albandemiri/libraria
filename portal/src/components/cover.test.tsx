import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import { useBook } from '../api/books';
import i18n from '../i18n';
import CoverPanel from './CoverPanel';

expect.extend(axeMatchers);
// jsdom has no canvas, so axe cannot compute colours; contrast is verified by calculation instead.
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

const size = vi.hoisted(() => ({
  value: { width: 1600, height: 2400 } as { width: number; height: number } | null,
}));
vi.mock('../lib/image', () => ({ readImageSize: async () => size.value }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

let bookOver: Record<string, unknown> = {};

function makeBook(version: number | null) {
  return {
    id: 'b1',
    publisherId: 'p1',
    title: 'Night Train',
    author: 'A',
    isbn13: null,
    description: null,
    genre: 'Fiction',
    language: 'en',
    price: { amountCents: 999, currency: 'EUR' },
    coverImageUrl: version === null ? null : `/api/v1/books/b1/cover?v=${version}`,
    coverThumbUrl: version === null ? null : `/api/v1/books/b1/cover?size=thumb&v=${version}`,
    publishedAt: null,
    isAvailable: false,
    mediaType: 'ebook',
    durationSeconds: null,
    status: 'draft',
    latestAsset: null,
    hasAsset: false,
    fileSizeBytes: null,
    metrics: { salesCount: 0, totalRevenueCents: 0, earningsCents: 0 },
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...bookOver,
  };
}

const fetchMock = vi.fn();
let version: number | null;
let putResponse: (() => Response | Promise<Response>) | null;
let deleteResponse: (() => Response) | null;

function Harness() {
  const book = useBook('b1');
  return book.data ? <CoverPanel book={book.data} /> : null;
}

function renderPanel(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'cover.png', { type: 'image/png' });
const previewSrc = (c: HTMLElement) => c.querySelector('img')?.getAttribute('src') ?? null;
const calls = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  size.value = { width: 1600, height: 2400 };
  version = 1;
  putResponse = null;
  deleteResponse = null;
  bookOver = {};
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (!String(url).includes('/publisher/books/b1')) return json(404, { error: { code: 'X' } });
    if (method === 'PUT') {
      if (putResponse) return await putResponse();
      version = (version ?? 0) + 1;
      // Like the real server, the PUT response carries no derived `status`.
      return json(200, { book: { ...makeBook(version), status: undefined } });
    }
    if (method === 'DELETE') {
      if (deleteResponse) return deleteResponse();
      version = null;
      return json(200, { book: makeBook(null) });
    }
    return json(200, { book: makeBook(version) });
  });
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});
afterEach(() => vi.unstubAllGlobals());

/** Lets pending promises and short timers run, so a "nothing happened" check is deterministic. */
async function settle() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await act(() => vi.advanceTimersByTimeAsync(500));
  } finally {
    vi.useRealTimers();
  }
}

describe('CoverPanel', () => {
  it('uploads the raw image with its content type and shows the new version', async () => {
    scope.value = { ...scope.value, isAdmin: true, publisherId: 'p1' };
    const { container } = renderPanel();
    await waitFor(() => expect(previewSrc(container)).toBe('/api/v1/books/b1/cover?v=1'));
    const file = png();
    await userEvent.upload(screen.getByLabelText('Replace cover'), file);
    await waitFor(() => expect(calls('PUT').length).toBe(1));
    const [url, init] = calls('PUT')[0] as [string, RequestInit];
    expect(url).toContain('/publisher/books/b1/cover');
    expect(url).toContain('publisherId=p1');
    expect(new Headers(init.headers).get('Content-Type')).toBe('image/png');
    expect(init.body).toBe(file);
    await waitFor(() => expect(previewSrc(container)).toBe('/api/v1/books/b1/cover?v=2'));
  });

  it('refuses a too-large file or a GIF in the browser, and focuses the message', async () => {
    renderPanel();
    const input = await screen.findByLabelText('Replace cover');
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(input, png(10 * 1024 * 1024 + 1));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The image is larger than the 10 MB limit.');
    await waitFor(() => expect(alert.closest('[tabindex="-1"]')).toHaveFocus());
    await user.upload(input, new File(['x'], 'a.gif', { type: 'image/gif' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Use a JPEG, PNG or WebP image.');
    expect(calls('PUT').length).toBe(0);
  });

  it('refuses an image under 400 px wide or with an extreme shape, before any request', async () => {
    renderPanel();
    const input = await screen.findByLabelText('Replace cover');
    size.value = { width: 300, height: 450 };
    await userEvent.upload(input, png());
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 400 px wide/);
    size.value = { width: 500, height: 1600 };
    await userEvent.upload(input, png());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/too long or too wide/),
    );
    expect(calls('PUT').length).toBe(0);
  });

  it('warns about a low resolution without refusing the upload', async () => {
    size.value = { width: 1000, height: 1500 };
    renderPanel();
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    expect(await screen.findByText(/under 1400 px wide/)).toBeInTheDocument();
    await waitFor(() => expect(calls('PUT').length).toBe(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    [413, 'COVER_TOO_LARGE', 'The image is larger than the 10 MB limit.'],
    [415, 'COVER_UNSUPPORTED_TYPE', 'Use a JPEG, PNG or WebP image.'],
    [422, 'COVER_TOO_SMALL', 'The image is too small. It must be at least 400 px wide.'],
    [422, 'COVER_INVALID', 'This image could not be read. It may be damaged or not a real image.'],
    [
      422,
      'COVER_BAD_SHAPE',
      'The image is too long or too wide. Use a shape close to a book cover (2:3).',
    ],
    [503, 'COVER_BUSY', 'The server is busy. Try again in a few seconds.'],
    [400, 'PUBLISHER_ID_REQUIRED', 'Choose a publisher first.'],
  ])(
    'maps %s %s to its own translated text, never the backend English',
    async (status, code, en) => {
      putResponse = () =>
        json(status, { error: { code, message: 'Backend English', requestId: 'r' } });
      renderPanel();
      await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
      expect(await screen.findByRole('alert')).toHaveTextContent(en);
      expect(screen.queryByText('Backend English')).not.toBeInTheDocument();
      await i18n.changeLanguage('sq');
      const sq = i18n.t(`cover.errors.${code}`);
      expect(sq).not.toBe(`cover.errors.${code}`);
      expect(sq).not.toBe(en);
      expect(await screen.findByText(sq)).toBeInTheDocument();
    },
  );

  it('removes the uploaded cover after a confirmation and falls back', async () => {
    const { container } = renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove cover' }));
    expect(calls('DELETE').length).toBe(0);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(calls('DELETE').length).toBe(1));
    await waitFor(() => expect(container.querySelector('img')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Remove cover' })).not.toBeInTheDocument();
  });

  it('has no axe violations when empty, with a cover, and with an error', async () => {
    version = null;
    const empty = renderPanel();
    await screen.findByLabelText('Upload cover');
    expect(await axe(empty.container)).toHaveNoViolations();
    empty.unmount();

    version = 1;
    putResponse = () =>
      json(422, { error: { code: 'COVER_INVALID', message: 'x', requestId: 'r' } });
    const withCover = renderPanel();
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    await screen.findByRole('alert');
    expect(await axe(withCover.container)).toHaveNoViolations();
  });
});

describe('CoverPanel fix round 1', () => {
  const change = (input: HTMLElement, file: File) =>
    fireEvent.change(input, { target: { files: [file] } });
  const apiErr = (status: number, code: string) =>
    json(status, { error: { code, message: 'Backend English', requestId: 'r' } });

  it('sends a file with no type as octet-stream and lets the server decide', async () => {
    renderPanel();
    const input = await screen.findByLabelText('Replace cover');
    await userEvent
      .setup({ applyAccept: false })
      .upload(input, new File([new Uint8Array(10)], 'cover', { type: '' }));
    await waitFor(() => expect(calls('PUT').length).toBe(1));
    const init = calls('PUT')[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/octet-stream');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends one request when two files arrive in the same tick', async () => {
    renderPanel();
    const input = await screen.findByLabelText('Replace cover');
    change(input, png());
    change(input, png());
    await waitFor(() => expect(calls('PUT').length).toBe(1));
    await settle();
    expect(calls('PUT').length).toBe(1);
  });

  it('focuses the upload control after a successful remove', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove cover' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(screen.getByLabelText('Upload cover')).toHaveFocus());
  });

  it('focuses the error after a failed remove, once the dialog has closed', async () => {
    deleteResponse = () => apiErr(503, 'COVER_BUSY');
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove cover' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, remove it' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(alert.closest('[tabindex="-1"]')).toHaveFocus());
  });

  it('keeps the cover and sends no DELETE when the confirmation is cancelled', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove cover' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(calls('DELETE').length).toBe(0);
  });

  it.each([
    ['RATE_LIMITED', 429, 'Too many uploads. Please try again later.', 'RATE_LIMITED', {}],
    ['NOT_FOUND', 404, 'This book could not be found.', 'NOT_FOUND', {}],
    ['FORBIDDEN', 403, "You don't have permission to change this cover.", 'FORBIDDEN_OTHER', {}],
    ['SOMETHING_NEW', 500, 'The cover could not be saved. Please try again.', 'generic', {}],
  ])('maps %s (%s) to its own text in en and sq', async (code, status, en, key) => {
    putResponse = () => apiErr(status, code);
    renderPanel();
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    expect(await screen.findByRole('alert')).toHaveTextContent(en);
    expect(screen.queryByText('Backend English')).not.toBeInTheDocument();
    await i18n.changeLanguage('sq');
    const sq = i18n.t(`cover.errors.${key}`);
    expect(sq).not.toBe(`cover.errors.${key}`);
    expect(sq).not.toBe(en);
    expect(await screen.findByText(sq)).toBeInTheDocument();
  });

  it('keeps the withdrawn wording for FORBIDDEN apart from the permission wording', async () => {
    // A withdrawn book disables the panel, so the withdrawn text is only reachable in a race;
    // for a book that is not withdrawn the message must be the permission one.
    putResponse = () => apiErr(403, 'FORBIDDEN');
    renderPanel();
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    expect(await screen.findByRole('alert')).not.toHaveTextContent('withdrawn');
    expect(i18n.getFixedT('en')('cover.errors.FORBIDDEN')).toContain('withdrawn');
    expect(i18n.getFixedT('sq')('cover.errors.FORBIDDEN_OTHER')).toContain('leje');
  });

  it('falls back on the status when the error has no code', async () => {
    putResponse = () => new Response('<html>too big</html>', { status: 413 });
    renderPanel();
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    expect(await screen.findByRole('alert')).toHaveTextContent('larger than the 10 MB limit');
    putResponse = () => new Response('nope', { status: 415 });
    await userEvent.upload(screen.getByLabelText('Replace cover'), png());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Use a JPEG, PNG or WebP image.'),
    );
  });

  it('shows no cover error on a 401; the global handler acts', async () => {
    putResponse = () => apiErr(401, 'UNAUTHORIZED');
    renderPanel();
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    await waitFor(() => expect(calls('PUT').length).toBe(1));
    await settle();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disables the panel for a withdrawn book and says why', async () => {
    bookOver = { status: 'withdrawn' };
    renderPanel();
    expect(await screen.findByLabelText('Replace cover')).toBeDisabled();
    expect(screen.getByText(/has been withdrawn, so its cover/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove cover' })).not.toBeInTheDocument();
  });

  it('offers Remove for an old external link, but not for an EPUB-derived cover', async () => {
    bookOver = { coverImageUrl: 'https://old.example/cover.jpg', coverThumbUrl: null };
    const first = renderPanel();
    expect(await screen.findByRole('button', { name: 'Remove cover' })).toBeInTheDocument();
    first.unmount();
    bookOver = { coverImageUrl: '/api/v1/books/b1/cover?v=3', coverThumbUrl: null };
    renderPanel();
    await screen.findByLabelText('Upload cover');
    expect(screen.queryByRole('button', { name: 'Remove cover' })).not.toBeInTheDocument();
  });

  it('survives an unmount during an upload and still refreshes the books', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    putResponse = async () => {
      await gate;
      return json(200, { book: makeBook(2) });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const view = renderPanel(client);
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    await waitFor(() => expect(calls('PUT').length).toBe(1));
    view.unmount();
    release();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] }));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('has no axe violations in the confirm dialog', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove cover' }));
    const dialog = await screen.findByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });

  it('has no axe violations with the low-resolution notice', async () => {
    size.value = { width: 1000, height: 1500 };
    putResponse = () => json(200, { book: makeBook(2) });
    const view = renderPanel();
    await userEvent.upload(await screen.findByLabelText('Replace cover'), png());
    await screen.findByText(/under 1400 px wide/);
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('words the low-resolution warning naturally in Albanian', () => {
    expect(i18n.getFixedT('sq')('cover.lowRes')).toMatch(
      /^Ky imazh është më pak se 1400 px i gjerë/,
    );
  });
});
