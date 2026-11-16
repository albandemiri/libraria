import type { MetaDescriptor } from 'react-router';
import { createI18n, type Lang } from '../i18n';
import { bookHref, coverSrc } from '../lib/format';
import type { BookDetail } from '../lib/types';

const DESCRIPTION_LENGTH = 160;

/** The description's first 160 characters, on one line; a generated sentence when there is none. */
function metaDescription(book: BookDetail, lang: Lang): string {
  const text = book.description?.replace(/\s+/g, ' ').trim();
  if (text) return text.slice(0, DESCRIPTION_LENGTH).trimEnd();
  const { t } = createI18n(lang);
  return t('book.metaDescription', {
    title: book.title,
    author: book.author,
    publisher: book.publisher.name,
  });
}

/** Drops null and undefined values, so nothing prints "null" in the head. */
function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v != null)) as Partial<T>;
}

/** Title, description, canonical, Open Graph, Twitter card and schema.org/Book JSON-LD. */
export function bookMeta(book: BookDetail, origin: string, lang: Lang): MetaDescriptor[] {
  const { t } = createI18n(lang);
  const title = t('book.metaTitle', { title: book.title, author: book.author });
  const description = metaDescription(book, lang);
  const url = `${origin}${bookHref(book)}`;
  const cover = coverSrc(book);
  const image = cover ? `${origin}${cover}` : null;
  const onSale = book.availability === 'on_sale' && book.forSale;

  const jsonLd = compact({
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: book.title,
    author: { '@type': 'Person', name: book.author },
    isbn: book.isbn13,
    inLanguage: book.language,
    publisher: { '@type': 'Organization', name: book.publisher.name },
    image,
    url,
    description: book.description ? description : null,
    datePublished: book.publishedAt ? book.publishedAt.slice(0, 10) : null,
    bookFormat: 'https://schema.org/EBook',
    numberOfPages: book.pageCount,
    offers: onSale
      ? {
          '@type': 'Offer',
          price: (book.price.amountCents / 100).toFixed(2),
          priceCurrency: book.price.currency,
          availability: 'https://schema.org/InStock',
          url,
        }
      : null,
  });

  const tags: MetaDescriptor[] = [
    { title },
    { name: 'description', content: description },
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:type', content: 'book' },
    { property: 'og:site_name', content: t('app.name') },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:url', content: url },
    { property: 'og:locale', content: lang === 'en' ? 'en_US' : 'sq_AL' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: description },
  ];
  if (image) {
    tags.push(
      { property: 'og:image', content: image },
      { property: 'og:image:alt', content: t('book.coverAlt', { title: book.title }) },
      { name: 'twitter:image', content: image },
    );
  }
  if (book.isbn13) tags.push({ property: 'book:isbn', content: book.isbn13 });
  tags.push({ 'script:ld+json': jsonLd });
  return tags;
}
