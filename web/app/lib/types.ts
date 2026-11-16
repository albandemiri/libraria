// Shapes returned by the Libraria API. The backend does not export them, so they are copied here.
// This module has no server imports, so client code may use it freely.

/** The signed-in reader, as kept in the session cookie. */
export type SessionUser = { id: string; email: string; displayName: string };

export interface StoreBook {
  id: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  price: { amountCents: number; currency: string };
  coverImageUrl: string | null;
  publishedAt: string | null;
  publisher: { id: string; name: string };
  /** The publisher has a commission rate in force. */
  forSale: boolean;
  /** Present only for signed-in callers. */
  owned?: boolean;
  /** Kept for the mobile app. */
  mediaType: 'ebook' | 'audiobook';
  durationSeconds: number | null;
}

export interface PublisherSummary {
  id: string;
  name: string;
  country: string | null;
  bookCount: number;
  genres: string[];
  newestYear: number | null;
}

export type Availability = 'on_sale' | 'not_for_sale' | 'archived' | 'taken_down';

export interface BookDetail extends StoreBook {
  pageCount: number | null;
  availability: Availability;
}

export interface Viewer {
  owned: boolean;
  acquiredAt: string | null;
  progress: { percent: number | null; chapterTitle: string | null } | null;
  /** Latest refunded purchase, only when not owned. */
  refund: { purchasedAt: string; refundedAt: string } | null;
  /** A pending checkout containing this book. */
  pendingTransactionId: string | null;
}

export interface Facets {
  total: number;
  genres: Array<{ genre: string; bookCount: number }>;
  publishers: Array<{ id: string; name: string; bookCount: number }>;
  languages: Array<{ language: string; bookCount: number }>;
}

export interface Suggestions {
  /** At most 5. */
  titles: StoreBook[];
  /** At most 3. */
  authors: Array<{ name: string; bookCount: number; mainGenre: string }>;
  /** At most 3. */
  publishers: Array<{ id: string; name: string; bookCount: number }>;
}

export type DiscoverSection =
  | { type: 'featured'; book: StoreBook; related: StoreBook | null }
  | {
      type: 'strip';
      items: Array<{ label: 'new' | 'top_month' | 'genre' | 'publisher'; book: StoreBook }>;
    }
  | {
      type: 'continue_reading';
      items: Array<{
        book: StoreBook;
        percent: number | null;
        chapterTitle: string | null;
        lastReadAt: string;
      }>;
    }
  | { type: 'new_releases'; lead: StoreBook; books: StoreBook[] }
  | { type: 'most_read'; since: string; books: StoreBook[] }
  | {
      type: 'genres';
      genres: Array<{ genre: string; bookCount: number; coverBookIds: string[] }>;
    }
  | { type: 'publisher_spotlight'; publisher: PublisherSummary; books: StoreBook[] }
  | { type: 'interlude'; genre: string; bookCount: number; books: StoreBook[] };

export interface DiscoverResponse {
  issue: {
    isoYear: number;
    isoWeek: number;
    date: string;
    bookCount: number;
    publisherCount: number;
  };
  /** Fixed order; a section with no content is omitted. */
  sections: DiscoverSection[];
}

/** `GET /transactions/:id`: a purchase as the reader sees it. */
export interface Receipt {
  id: string;
  /** pending, paid, failed, cancelled or expired, plus refund and dispute states after paid. */
  status: string;
  provider: string;
  total: { amountCents: number; currency: string };
  /** Only while pending. */
  checkoutUrl: string | null;
  createdAt: string;
  paidAt: string | null;
  items: Array<{
    book: {
      id: string;
      title: string;
      author: string;
      coverImageUrl: string | null;
      publisher: { id: string; name: string };
    };
    unitPriceCents: number;
    refundedCents: number;
    refunded: boolean;
  }>;
}

/** `POST /checkout-sessions`. */
export interface CheckoutSession {
  transaction: Receipt;
  /** `url` is null for the simulated provider. */
  checkout: { provider: string; url: string | null };
}
