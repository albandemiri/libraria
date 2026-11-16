import { useTranslation } from 'react-i18next';
import { useLoaderData } from 'react-router';
import type { Lang } from '../i18n';
import type { BookDetail, StoreBook, Viewer } from '../lib/types';
import { Breadcrumbs } from '../ui';
import { BookDetails } from './BookDetails';
import { BookHero } from './BookHero';
import styles from './BookPage.module.css';
import { BookShelves } from './BookShelves';
import { splitDescription } from './description';
import { purchaseState } from './purchase-state';
import { Synopsis } from './Synopsis';

export type BookPageData = {
  lang: Lang;
  book: BookDetail;
  /** Null for guests. */
  viewer: Viewer | null;
  /** The canonical path, `/libri/:id/:slug`. */
  path: string;
  origin: string;
  /** A fresh idempotency key per render for "Bli librin" (see BuyForm). */
  checkoutKey?: string;
  shelves: { publisher: StoreBook[]; similar: StoreBook[]; author: StoreBook[] };
};

/** `/libri/:id/:slug`: the book as a literary work first, a product second. */
export function BookPage() {
  const { t } = useTranslation();
  const { book, viewer, path, shelves, checkoutKey } = useLoaderData() as BookPageData;
  const state = purchaseState(book, viewer);
  // One split for the whole page, so no description text appears twice.
  const { lede, body } = splitDescription(book.description);
  const genre = t(`genres.${book.genre}`, { defaultValue: book.genre });
  // The phone's pinned purchase bar needs room below the content.
  const pinned = state !== 'not_for_sale' && state !== 'owned_taken_down';

  return (
    <article className={`${styles.page} ${pinned ? styles.withBar : ''}`}>
      <div className={styles.crumbs}>
        <Breadcrumbs
          items={[
            { label: t('nav.explore'), href: '/eksploro' },
            { label: genre, href: `/eksploro/${encodeURIComponent(book.genre)}` },
            { label: book.title },
          ]}
        />
      </div>
      <BookHero
        book={book}
        viewer={viewer}
        state={state}
        path={path}
        lede={lede}
        checkoutKey={checkoutKey}
      />
      <div className={styles.about}>
        <BookDetails book={book} />
        <Synopsis book={book} paragraphs={body} />
      </div>
      <BookShelves book={book} shelves={shelves} />
    </article>
  );
}
