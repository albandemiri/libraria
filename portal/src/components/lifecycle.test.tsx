import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureAxe } from 'vitest-axe';
import * as axeMatchers from 'vitest-axe/matchers';
import i18n from '../i18n';
import en from '../i18n/en.json';
import sq from '../i18n/sq.json';
import BookEditorPage from '../pages/BookEditorPage';
import BookPage from '../pages/BookPage';
import CatalogPage from '../pages/CatalogPage';

expect.extend(axeMatchers);
const axe = configureAxe({
  rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
});

const scope = vi.hoisted(() => ({
  value: {
    publisherId: undefined as string | undefined,
    setPublisherId: () => undefined,
    isAdmin: false,
    publishers: [] as Array<{ id: string; name: string }>,
  },
}));
vi.mock('../layout/PublisherScope', () => ({ usePublisherScope: () => scope.value }));

type TestBook = Record<string, unknown>;

function makeBook(over: TestBook = {}): TestBook {
  return {
    id: 'b1',
    publisherId: 'p1',
    title: 'Draft Novel',
    author: 'A. Author',
    isbn13: null,
    description: 'A story.',
    genre: 'Fiction',
    language: 'en',
    price: { amountCents: 1299, currency: 'EUR' },
    coverImageUrl: null,
    coverThumbUrl: null,
    publishedAt: null,
    isAvailable: false,
    mediaType: 'ebook',
    durationSeconds: null,
    status: 'draft',
    canDelete: true,
    latestAsset: null,
    hasAsset: true,
    fileSizeBytes: null,
    metrics: { salesCount: 0, totalRevenueCents: 0, earningsCents: 0 },
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...over,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const apiError = (status: number, code: string) =>
  json(status, { error: { code, message: 'backend english', requestId: 'r' } });

const fetchMock = vi.fn();
let books: TestBook[];
let one: TestBook;
let respond: Record<string, () => Response>;

function route(url: string, init?: RequestInit): Response {
  const method = init?.method ?? 'GET';
  const path = new URL(url, 'http://x').pathname;
  const key = `${method} ${path.replace('/api/v1/publisher', '')}`;
  const custom = respond[key];
  if (custom) return custom();
  if (/\/publisher\/books\/b1\/assets/.test(url)) return json(200, { assets: [] });
  if (/\/publisher\/books\/b1$/.test(path) && method === 'GET') return json(200, { book: one });
  if (/\/publisher\/books$/.test(path) && method === 'GET') {
    return json(200, {
      books,
      pagination: { page: 1, limit: 20, total: books.length, totalPages: 1 },
    });
  }
  return apiError(404, 'NOT_FOUND');
}

const calls = () => fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? 'GET'} ${String(u)}`);
const did = (method: string, suffix: string) =>
  calls().some((c) => c.startsWith(`${method} `) && c.includes(suffix));

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Where />
          <Routes>
            <Route path="/catalog" element={<CatalogPage />} />
            <Route path="/catalog/:bookId/edit" element={<BookEditorPage />} />
            <Route path="/catalog/:bookId" element={<BookPage />} />
            <Route path="/catalog/:bookId/:tab" element={<BookPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(async () => {
  scope.value = { ...scope.value, publisherId: undefined, isAdmin: false };
  books = [makeBook()];
  one = makeBook();
  respond = {};
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => route(String(url), init));
  vi.stubGlobal('fetch', fetchMock);
  await i18n.changeLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

type User = ReturnType<typeof userEvent.setup>;
const MORE = /^More actions for Draft Novel$/;

async function openMore(user: User) {
  await user.click(await screen.findByRole('button', { name: MORE }));
  return screen.findByRole('menu');
}

const names = (menu: HTMLElement) =>
  within(menu)
    .getAllByRole('menuitem')
    .map((i) => i.textContent);

describe('book actions by status', () => {
  it('a draft that can be deleted offers Publish, Edit, and Archive and Delete in More', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(names(await openMore(user))).toEqual(['Archive', 'Delete']);
  });

  it('a published book offers Unpublish, and no Delete when it cannot be deleted', async () => {
    one = makeBook({ status: 'published', isAvailable: true, canDelete: false });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    expect(await screen.findByRole('button', { name: 'Unpublish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    const menu = await openMore(user);
    expect(names(menu)).toEqual(['Archive']);
    expect(within(menu).getByText(/can't be deleted right now/)).toBeInTheDocument();
  });

  it('an archived book offers Restore (and Delete when allowed) but no Publish or Edit', async () => {
    one = makeBook({ status: 'archived', canDelete: true });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await screen.findByRole('heading', { name: 'Draft Novel' });
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(
      screen.getByText(/This book is archived. It is off sale and read-only/),
    ).toBeInTheDocument();
    expect(names(await openMore(user))).toEqual(['Restore', 'Delete']);
  });

  it('a withdrawn book has no lifecycle actions', async () => {
    one = makeBook({ status: 'withdrawn', canDelete: false });
    renderAt('/catalog/b1');
    await screen.findByRole('heading', { name: 'Draft Novel' });
    expect(screen.queryByRole('button', { name: MORE })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('the More menu works from the keyboard', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    const trigger = await screen.findByRole('button', { name: MORE });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    // Opening from the keyboard lands on the first item.
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(trigger).toHaveFocus();
  });
});

describe('confirmation dialogs', () => {
  it('Unpublish asks first, then calls the server', async () => {
    one = makeBook({ status: 'published', isAvailable: true, canDelete: false });
    respond['POST /books/b1/unpublish'] = () => json(200, { book: makeBook({ status: 'ready' }) });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await user.click(await screen.findByRole('button', { name: 'Unpublish' }));
    const dialog = await screen.findByRole('dialog', { name: 'Unpublish this book?' });
    expect(did('POST', '/unpublish')).toBe(false);
    expect(within(dialog).getByText(/keep reading/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Unpublish' }));
    await waitFor(() => expect(did('POST', '/books/b1/unpublish')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Archive explains that buyers keep access, and can be cancelled', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive this book?' });
    expect(within(dialog).getByText(/keep their copies/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(did('POST', '/archive')).toBe(false);
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }),
    );
    await waitFor(() => expect(did('POST', '/books/b1/archive')).toBe(true));
  });

  it('Restore calls the server straight away', async () => {
    one = makeBook({ status: 'archived' });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(did('POST', '/books/b1/restore')).toBe(true));
  });
});

describe('Delete asks for the title', () => {
  async function openDelete(user: User) {
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this book permanently?' });
    return {
      dialog,
      confirm: within(dialog).getByRole('button', { name: 'Delete permanently' }),
      input: within(dialog).getByLabelText('Book title'),
    };
  }

  it('keeps the button disabled until the exact title is typed (spaces ignored, case matters)', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    const { confirm, input } = await openDelete(user);
    expect(confirm).toBeDisabled();
    await user.type(input, 'draft novel');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'Draft Nove');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, '   Draft Novel  ');
    expect(confirm).toBeEnabled();
    expect(did('DELETE', '/books/b1')).toBe(false);
  });

  it('does not delete when Enter is pressed with a wrong title', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    const { input } = await openDelete(user);
    await user.type(input, 'nope{Enter}');
    expect(did('DELETE', '/books/b1')).toBe(false);
  });

  it('deletes, goes to the catalog and shows a notice', async () => {
    respond['DELETE /books/b1'] = () => new Response(null, { status: 204 });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    const { confirm, input } = await openDelete(user);
    await user.type(input, 'Draft Novel');
    await user.click(confirm);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/catalog$/));
    expect(await screen.findByText('“Draft Novel” was deleted.')).toBeInTheDocument();
    expect(did('DELETE', '/publisher/books/b1')).toBe(true);
  });
});

describe('server refusals', () => {
  const cases: Array<[string, number, string]> = [
    ['BOOK_PUBLISHED', 409, 'Unpublish this book before deleting it.'],
    ['BOOK_HAS_SALES', 409, 'cannot be deleted'],
    ['ASSET_PROCESSING', 409, 'being processed'],
    ['BOOK_ARCHIVED', 409, 'archived'],
    ['FORBIDDEN', 403, 'withdrawn'],
    ['NOT_FOUND', 404, 'could not be found'],
  ];
  for (const [code, status, text] of cases) {
    it(`shows translated text for ${code} and moves focus to it`, async () => {
      respond['DELETE /books/b1'] = () => apiError(status, code);
      const user = userEvent.setup();
      renderAt('/catalog/b1');
      await openMore(user);
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this book permanently?' });
      await user.type(within(dialog).getByLabelText('Book title'), 'Draft Novel');
      await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(text);
      expect(alert).not.toHaveTextContent('backend english');
      await waitFor(() => expect(alert.closest('[tabindex="-1"]')).toHaveFocus());
      expect(screen.getByTestId('where')).toHaveTextContent('/catalog/b1');
    });
  }

  it('a stale Publish that the server refuses shows text in Albanian', async () => {
    await i18n.changeLanguage('sq');
    respond['POST /books/b1/publish'] = () => apiError(409, 'BOOK_ARCHIVED');
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await user.click(await screen.findByRole('button', { name: 'Publiko' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(sq.lifecycle.errors.BOOK_ARCHIVED);
    expect(alert.textContent).not.toBe(en.lifecycle.errors.BOOK_ARCHIVED);
  });

  it('refetches the book after a refusal so a stale action disappears', async () => {
    respond['POST /books/b1/archive'] = () => apiError(409, 'BOOK_ARCHIVED');
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    one = makeBook({ status: 'archived' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await screen.findByRole('alert');
    await waitFor(() =>
      expect(
        screen.getByText(/This book is archived. It is off sale and read-only/),
      ).toBeInTheDocument(),
    );
  });
});

describe('i18n', () => {
  const keys = (o: Record<string, unknown>, p = ''): string[] =>
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null
        ? keys(v as Record<string, unknown>, `${p}${k}.`)
        : [`${p}${k}`],
    );
  it('en and sq have identical lifecycle keys', () => {
    expect(keys(sq.lifecycle).sort()).toEqual(keys(en.lifecycle).sort());
  });
  it('has natural labels for the archived status and the default filter', () => {
    expect(en.catalog.status.all).toBe('All except archived');
    expect(en.catalog.status.archived).toBe('Archived');
    expect(sq.catalog.status.archived).toBe('Arkivuar');
    expect(sq.catalog.status.all).not.toBe(en.catalog.status.all);
  });
});

describe('Catalog', () => {
  it('defaults to all books except archived and offers Archived, which asks the server for archived', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await screen.findByText('Draft Novel');
    const select = screen.getByLabelText('Status');
    expect(within(select).getByRole('option', { name: 'All except archived' })).toBeInTheDocument();
    expect(select).toHaveValue('all');
    expect(calls().some((c) => c.includes('status=archived'))).toBe(false);
    await user.selectOptions(select, 'archived');
    await waitFor(() => expect(calls().some((c) => c.includes('status=archived'))).toBe(true));
    expect(screen.getByTestId('where')).toHaveTextContent('status=archived');
  });

  it('shows an Archived badge for an archived book', async () => {
    books = [makeBook({ status: 'archived' })];
    renderAt('/catalog?status=archived');
    const card = (await screen.findByText('Draft Novel')).closest('button') as HTMLElement;
    expect(within(card).getByText('Archived')).toBeInTheDocument();
  });

  it('each table row has an actions menu that archives and stays on the catalog', async () => {
    respond['POST /books/b1/archive'] = () => json(200, { book: makeBook({ status: 'archived' }) });
    const user = userEvent.setup();
    renderAt('/catalog');
    await user.click(await screen.findByRole('radio', { name: 'Table' }));
    const row = (await screen.findByRole('link', { name: 'Draft Novel' })).closest(
      'tr',
    ) as HTMLElement;
    await user.click(within(row).getByRole('button', { name: MORE }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive this book?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(did('POST', '/books/b1/archive')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/catalog$/);
  });

  it('each card has an actions menu that archives without opening the book', async () => {
    respond['POST /books/b1/archive'] = () => json(200, { book: makeBook({ status: 'archived' }) });
    const user = userEvent.setup();
    renderAt('/catalog');
    await user.click(await screen.findByRole('button', { name: MORE }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/catalog$/);
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive this book?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(did('POST', '/books/b1/archive')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/catalog$/);
  });

  it('gives each book a distinct menu name', async () => {
    books = [makeBook(), makeBook({ id: 'b2', title: 'Other Tale' })];
    renderAt('/catalog');
    await screen.findByText('Other Tale');
    expect(
      screen.getByRole('button', { name: 'More actions for Draft Novel' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'More actions for Other Tale' })).toBeInTheDocument();
  });

  it('after an archive from a card, focus goes to the catalog heading', async () => {
    respond['POST /books/b1/archive'] = () => {
      books = [];
      return json(200, { book: makeBook({ status: 'archived' }) });
    };
    const user = userEvent.setup();
    renderAt('/catalog');
    await user.click(await screen.findByRole('button', { name: MORE }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }),
    );
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Catalog' });
    await waitFor(() => expect(h1).toHaveFocus());
  });

  it('clears the deleted notice on the next filter change', async () => {
    respond['DELETE /books/b1'] = () => new Response(null, { status: 204 });
    const user = userEvent.setup();
    renderAt('/catalog');
    await user.click(await screen.findByRole('button', { name: MORE }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Book title'), 'Draft Novel');
    await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
    expect(await screen.findByText('“Draft Novel” was deleted.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Status'), 'draft');
    await waitFor(() => expect(screen.queryByText('“Draft Novel” was deleted.')).toBeNull());
  });
});

describe('archived books are read-only', () => {
  beforeEach(() => {
    one = makeBook({ status: 'archived' });
  });

  it('the editor disables the form, hides Save and explains', async () => {
    renderAt('/catalog/b1/edit');
    await screen.findByRole('heading', { name: 'Edit book' });
    expect(
      screen.getByText(/This book is archived. It is off sale and read-only/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeDisabled();
    expect(screen.getByLabelText(/^Price/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('the files tab disables the cover and EPUB uploads', async () => {
    const { container } = renderAt('/catalog/b1/files');
    await screen.findByText(/EPUB file/);
    await waitFor(() => {
      const inputs = container.querySelectorAll('input[type="file"]');
      expect(inputs.length).toBe(2);
      for (const input of inputs) expect(input).toBeDisabled();
    });
  });
});

describe('accessibility', () => {
  it('the book page with the menu open has no violations', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('the delete dialog has no violations', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

async function typeTitleAndDelete(user: User) {
  await openMore(user);
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog');
  await user.type(within(dialog).getByLabelText('Book title'), 'Draft Novel');
  await user.click(within(dialog).getByRole('button', { name: 'Delete permanently' }));
}

describe('focus', () => {
  it('Cancel and Esc return focus to the menu trigger', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    const trigger = await screen.findByRole('button', { name: MORE });
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();

    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it('after a delete, focus lands on the catalog notice', async () => {
    respond['DELETE /books/b1'] = () => new Response(null, { status: 204 });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await typeTitleAndDelete(user);
    const notice = (await screen.findByText('“Draft Novel” was deleted.')).closest(
      '[tabindex="-1"]',
    );
    await waitFor(() => expect(notice).toHaveFocus());
  });

  it('after an archive from the book page, focus lands on the archived notice', async () => {
    respond['POST /books/b1/archive'] = () => {
      one = makeBook({ status: 'archived' });
      return json(200, { book: one });
    };
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }),
    );
    const notice = (await screen.findByText(/This book is archived. It is off sale/)).closest(
      '[tabindex="-1"]',
    );
    await waitFor(() => expect(notice).toHaveFocus());
  });

  it('the delete dialog opens with the title input focused', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByLabelText('Book title')).toHaveFocus());
  });
});

describe('one action at a time', () => {
  it('pressing Enter twice in the title input sends a single DELETE', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        await new Promise((r) => setTimeout(r, 50));
        return new Response(null, { status: 204 });
      }
      return route(String(url), init);
    });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Book title'), 'Draft Novel{Enter}{Enter}');
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/catalog$/));
    expect(calls().filter((c) => c.startsWith('DELETE ')).length).toBe(1);
  });

  it('drops the deleted book from the cache instead of refetching it', async () => {
    respond['DELETE /books/b1'] = () => new Response(null, { status: 204 });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await typeTitleAndDelete(user);
    await screen.findByText('“Draft Novel” was deleted.');
    const all = calls();
    const after = all.slice(all.findIndex((c) => c.startsWith('DELETE ')) + 1);
    expect(after.some((c) => /^GET .*\/publisher\/books\/b1(\?|$)/.test(c))).toBe(false);
  });
});

describe('Publish without a file', () => {
  it('is disabled with a hint when the book has no EPUB', async () => {
    one = makeBook({ hasAsset: false });
    renderAt('/catalog/b1');
    const publish = await screen.findByRole('button', { name: 'Publish' });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAccessibleDescription('Upload an EPUB file to enable publishing.');
  });

  it('is enabled when there is one', async () => {
    renderAt('/catalog/b1');
    expect(await screen.findByRole('button', { name: 'Publish' })).toBeEnabled();
  });
});

describe('accessibility with overlays open', () => {
  it('the Catalog with row menus has no violations', async () => {
    const user = userEvent.setup();
    renderAt('/catalog');
    await user.click(await screen.findByRole('radio', { name: 'Table' }));
    await screen.findByRole('link', { name: 'Draft Novel' });
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: MORE }));
    await screen.findByRole('menu');
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('an archived book page has no violations', async () => {
    one = makeBook({ status: 'archived' });
    renderAt('/catalog/b1');
    await screen.findByText(/This book is archived. It is off sale/);
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('the archive dialog has no violations', async () => {
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await openMore(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await screen.findByRole('dialog', { name: 'Archive this book?' });
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('the unpublish dialog has no violations', async () => {
    one = makeBook({ status: 'published', isAvailable: true, canDelete: false });
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await user.click(await screen.findByRole('button', { name: 'Unpublish' }));
    await screen.findByRole('dialog', { name: 'Unpublish this book?' });
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('the error dialog has no violations', async () => {
    respond['POST /books/b1/publish'] = () => apiError(409, 'BOOK_ARCHIVED');
    const user = userEvent.setup();
    renderAt('/catalog/b1');
    await user.click(await screen.findByRole('button', { name: 'Publish' }));
    await screen.findByRole('alert');
    expect(await axe(document.body)).toHaveNoViolations();
  });
});
