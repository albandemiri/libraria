import { describe, expect, it } from 'vitest';
import type { BookDetail } from '../lib/types';
import { bookMeta } from './seo';

const ORIGIN = 'https://libraria.example';

function detail(overrides: Partial<BookDetail> = {}): BookDetail {
  return {
    id: '15459259-2a29-5a98-87aa-5f467426529a',
    title: 'Zonja e Hanit të Bardhë',
    author: 'Leart Osmani',
    isbn13: '9780000000095',
    description: 'Një roman i qetë për njerëz të zakonshëm në një qytet që ndryshon ngadalë.',
    genre: 'Fiction',
    language: 'sq',
    price: { amountCents: 599, currency: 'EUR' },
    coverImageUrl: '/api/v1/books/15459259-2a29-5a98-87aa-5f467426529a/cover?v=3',
    publishedAt: '2026-11-02T00:00:00.000Z',
    publisher: { id: '3179c2d0-524d-5ac4-b884-025de7590087', name: 'Pema e Kuqe Botime' },
    forSale: true,
    mediaType: 'ebook',
    durationSeconds: null,
    pageCount: 240,
    availability: 'on_sale',
    ...overrides,
  };
}

type Tag = Record<string, unknown>;
const ldOf = (tags: Tag[]) =>
  tags.find((t) => 'script:ld+json' in t)?.['script:ld+json'] as Record<string, unknown>;
const prop = (tags: Tag[], name: string) =>
  tags.find((t) => t.property === name || t.name === name)?.content;

describe('bookMeta', () => {
  it('has the title, description, canonical, Open Graph and Twitter tags', () => {
    const tags = bookMeta(detail(), ORIGIN, 'sq') as Tag[];
    expect(tags).toContainEqual({ title: 'Zonja e Hanit të Bardhë nga Leart Osmani — Libraria' });
    expect(prop(tags, 'description')).toBe(detail().description);
    expect(tags).toContainEqual({
      tagName: 'link',
      rel: 'canonical',
      href: `${ORIGIN}/libri/15459259-2a29-5a98-87aa-5f467426529a/zonja-e-hanit-te-bardhe`,
    });
    expect(prop(tags, 'og:type')).toBe('book');
    expect(prop(tags, 'og:image')).toBe(
      `${ORIGIN}/kopertina/15459259-2a29-5a98-87aa-5f467426529a?v=3`,
    );
    expect(prop(tags, 'twitter:card')).toBe('summary_large_image');
  });

  it('cuts the description to its first 160 characters', () => {
    const long = 'a'.repeat(400);
    const tags = bookMeta(detail({ description: long }), ORIGIN, 'sq') as Tag[];
    expect(prop(tags, 'description')).toHaveLength(160);
  });

  it('JSON-LD has an Offer only when on sale', () => {
    const onSale = ldOf(bookMeta(detail(), ORIGIN, 'sq') as Tag[]);
    expect(onSale).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Book',
      name: 'Zonja e Hanit të Bardhë',
      author: { '@type': 'Person', name: 'Leart Osmani' },
      isbn: '9780000000095',
      inLanguage: 'sq',
      publisher: { '@type': 'Organization', name: 'Pema e Kuqe Botime' },
      image: `${ORIGIN}/kopertina/15459259-2a29-5a98-87aa-5f467426529a?v=3`,
      offers: {
        '@type': 'Offer',
        price: '5.99',
        priceCurrency: 'EUR',
        availability: 'https://schema.org/InStock',
      },
    });
    for (const availability of ['not_for_sale', 'archived', 'taken_down'] as const) {
      const ld = ldOf(bookMeta(detail({ availability, forSale: false }), ORIGIN, 'sq') as Tag[]);
      expect(ld).toBeDefined();
      expect(ld).not.toHaveProperty('offers');
    }
  });

  it('leaves out what the book does not have, and never writes null', () => {
    const tags = bookMeta(
      detail({ description: null, coverImageUrl: null, isbn13: null, publishedAt: null }),
      ORIGIN,
      'en',
    ) as Tag[];
    expect(prop(tags, 'og:image')).toBeUndefined();
    expect(prop(tags, 'description')).toBeTruthy();
    const ld = ldOf(tags);
    expect(ld).not.toHaveProperty('image');
    expect(ld).not.toHaveProperty('isbn');
    expect(JSON.stringify(tags)).not.toMatch(/null|undefined/);
  });
});
