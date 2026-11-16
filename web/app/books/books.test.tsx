import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { configureAxe } from 'vitest-axe';
import { createI18n, type Lang } from '../i18n';
import type { StoreBook } from '../lib/types';
import { BookCard } from './BookCard';
import { BookCover } from './BookCover';
import { Masthead } from './Masthead';
import { PriceTag } from './PriceTag';
import { SectionHeader } from './SectionHeader';

const axe = configureAxe({ rules: { 'color-contrast': { enabled: false } } });

const book: StoreBook = {
  id: 'b1',
  title: 'Zonja e Hanit të Bardhë',
  author: 'Ana Dervishi',
  isbn13: null,
  description: null,
  genre: 'Fiction',
  language: 'sq',
  price: { amountCents: 599, currency: 'EUR' },
  coverImageUrl: '/api/v1/books/b1/cover?v=1',
  publishedAt: null,
  publisher: { id: 'p1', name: 'Botimet Dituria' },
  forSale: true,
  mediaType: 'ebook',
  durationSeconds: null,
};

function wrap(ui: ReactElement, lang: Lang = 'sq') {
  return render(
    <I18nextProvider i18n={createI18n(lang)}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nextProvider>,
  );
}

describe('BookCover', () => {
  it('renders the proxied image at 2:3 with explicit size, lazy by default', () => {
    const { container } = wrap(<BookCover book={book} alt="" />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/kopertina/b1?v=1');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(Number(img.getAttribute('height')) / Number(img.getAttribute('width'))).toBe(1.5);
  });

  it('is eager when priority', () => {
    const { container } = wrap(<BookCover book={book} priority />);
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('eager');
  });

  it('renders the typographic fallback when coverImageUrl is null', () => {
    const { container } = wrap(<BookCover book={{ ...book, coverImageUrl: null }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Zonja e Hanit të Bardhë')).toBeInTheDocument();
    expect(screen.getByText('Ana Dervishi')).toBeInTheDocument();
  });

  it('swaps to the fallback when the image errors', () => {
    const { container } = wrap(<BookCover book={book} />);
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Ana Dervishi')).toBeInTheDocument();
  });
});

describe('BookCard', () => {
  it.each(['grid', 'list', 'ranked', 'lead', 'compact'] as const)(
    'never prints "null" for missing description or publishedAt (%s)',
    (variant) => {
      const { container } = wrap(
        <BookCard book={book} variant={variant} rank={1} showGenre showPublisher />,
      );
      expect(container.textContent).not.toMatch(/null|undefined/);
      expect(screen.getByRole('link')).toHaveAttribute('href', '/libri/b1/zonja-e-hanit-te-bardhe');
    },
  );

  it('differs by variant', () => {
    wrap(<BookCard book={{ ...book, description: 'Një roman.' }} variant="lead" />);
    expect(screen.getByText('Një roman.')).toBeInTheDocument();
  });

  it('ranked shows the numeral; grid shows genre and publisher only on request', () => {
    const { container, rerender } = wrap(<BookCard book={book} variant="ranked" rank={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(container.textContent).toContain('5,99\u00a0€');
    rerender(
      <I18nextProvider i18n={createI18n('sq')}>
        <MemoryRouter>
          <BookCard book={book} variant="grid" showGenre showPublisher />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Prozë')).toBeInTheDocument();
    expect(screen.getByText('Botimet Dituria')).toBeInTheDocument();
  });

  it('tags a non-Albanian title without adding "EN" to the link name', () => {
    wrap(
      <BookCard book={{ ...book, language: 'en', title: 'The Quiet Harbour' }} variant="grid" />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAccessibleName(expect.stringContaining('(në anglisht)'));
    expect(link).not.toHaveAccessibleName(expect.stringContaining('EN'));
    expect(link.textContent).toContain('EN');
    expect(screen.getByText('EN')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows no language tag for Albanian books', () => {
    wrap(<BookCard book={book} variant="grid" />);
    expect(screen.queryByText('EN')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).not.toHaveAccessibleName(expect.stringContaining('('));
  });

  it('has no axe violations', async () => {
    const { container } = wrap(
      <ul>
        <li>
          <BookCard book={book} variant="grid" />
        </li>
      </ul>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('PriceTag', () => {
  it('shows the price, in the reader language', () => {
    const { container } = wrap(<PriceTag book={book} />, 'en');
    expect(container.textContent).toBe('€5.99');
  });

  it('shows owned and temporarily-unavailable states', () => {
    const { container, rerender } = wrap(<PriceTag book={{ ...book, owned: true }} />);
    expect(container.textContent).toBe('✓ Në bibliotekën tënde');
    rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <PriceTag book={{ ...book, forSale: false }} />
      </I18nextProvider>,
    );
    expect(container.textContent).toBe('Temporarily not for sale');
  });
});

describe('SectionHeader and Masthead', () => {
  it('renders kicker, heading and link', () => {
    wrap(
      <SectionHeader
        kicker="Nëntor"
        title="Më të lexuarat"
        action={{ href: '/eksploro', label: 'Të gjitha →' }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Më të lexuarat' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Të gjitha →' })).toHaveAttribute('href', '/eksploro');
  });

  it('renders the issue line', () => {
    const { container } = wrap(
      <Masthead
        issue={{ isoYear: 2026, isoWeek: 47, date: '2026-11-16', bookCount: 62, publisherCount: 4 }}
      />,
    );
    expect(container.textContent).toContain('Java 47 · 16 nëntor 2026');
    expect(container.textContent).toContain('62 libra · 4 botues');
  });
});
