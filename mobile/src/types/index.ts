export interface User {
  id: string;
  email: string;
  displayName: string | null;
  role: 'reader' | 'publisher' | 'admin';
}

export interface Book {
  id: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  price: {
    amountCents: number;
    currency: string;
  };
  coverImageUrl: string | null;
  publishedAt: string | null;
  mediaType: 'ebook' | 'audiobook';
  durationSeconds: number | null;
  publisher: {
    id: string;
    name: string;
  };
}

export interface ReadingProgress {
  cfi?: string;
  percent?: number;
  chapterTitle?: string;
  [key: string]: unknown;
}

export interface LibraryItem {
  book: {
    id: string;
    title: string;
    author: string;
    genre: string;
    coverImageUrl: string | null;
    mediaType: 'ebook' | 'audiobook';
    publisher: {
      id: string;
      name: string;
    };
  };
  acquiredAt: string;
  lastReadAt: string | null;
  readingProgress: ReadingProgress;
  bookmarksCount?: number;
  highlightsCount?: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  location: string;
  label: string | null;
  createdAt: string;
}

export interface Highlight {
  id: string;
  bookId: string;
  startLocation: string;
  endLocation: string;
  highlightedText: string;
  note: string | null;
  color: string;
  createdAt: string;
}

export interface TransactionReceipt {
  id: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  amount: {
    amountCents: number;
    currency: string;
  };
  paymentGatewayRef: string | null;
  createdAt: string;
  book: {
    id: string;
    title: string;
    author: string;
    coverImageUrl: string | null;
  };
}

