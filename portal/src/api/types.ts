export type PortalRole = 'reader' | 'publisher' | 'admin';

export type PortalUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: PortalRole;
  publisherId: string | null;
  createdAt: string;
};

export type PublisherSummary = { id: string; name: string };

export type Metrics = {
  grossCents: number;
  refundsCents: number;
  taxCents: number;
  feeCents: number;
  netCents: number;
  commissionAtSaleCents: number;
  commissionReversedCents: number;
  commissionCents: number;
  unsplitCents: number;
  earningsAtSaleCents: number;
  earningsReversedCents: number;
  earningsCents: number;
  copies: number;
  refundedCopies: number;
};

export type SummaryResponse = {
  totals: Metrics;
  series: Array<{ periodStart: string } & Metrics>;
};
export type ByBookRow = { book: { id: string; title: string } } & Metrics;
export type ByCountryRow = { country: string | null } & Metrics;

export type SalesStatus = 'paid' | 'partially_refunded' | 'refunded' | 'disputed';

export type SalesLine = {
  paidAt: string;
  transactionId: string;
  book: { id: string; title: string };
  country: string | null;
  status: SalesStatus;
  unitPriceCents: number;
  taxCents: number;
  feeCents: number | null;
  commissionRateBps: number | null;
  commissionCents: number;
  earningsCents: number;
  refundedCents: number;
  split: 'done' | 'pending' | 'no_rate';
};

export type SalesPage = {
  lines: SalesLine[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type MediaType = 'ebook' | 'audiobook';

export type Book = {
  id: string;
  publisherId: string;
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  price: { amountCents: number; currency: string };
  coverImageUrl: string | null;
  publishedAt: string | null;
  isAvailable: boolean;
  mediaType: MediaType;
  durationSeconds: number | null;
  hasAsset: boolean;
  fileSizeBytes: number | null;
  metrics: { salesCount: number; totalRevenueCents: number; earningsCents: number };
  createdAt: string;
  updatedAt: string;
};

export type BookStatusFilter = 'all' | 'published' | 'draft';

export type BookInput = {
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  priceCents: number;
  coverImageUrl: string | null;
  mediaType: MediaType;
  /** Only ever null: clears a duration that no longer applies. Absent leaves it unchanged. */
  durationSeconds?: null;
};

export type CommissionRate = {
  id: string;
  rateBps: number;
  effectiveFrom: string;
  contractReference: string | null;
  inForce: boolean;
};

export type ContractResponse = {
  publisherId: string;
  current: CommissionRate | null;
  history: CommissionRate[];
};
