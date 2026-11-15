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
export type ByBookRow = {
  book: {
    id: string;
    title: string;
    coverImageUrl: string | null;
    coverThumbUrl: string | null;
  };
} & Metrics;
export type ByCountryRow = { country: string | null } & Metrics;

export type SalesStatus = 'paid' | 'partially_refunded' | 'refunded' | 'disputed';

export type SalesLine = {
  paidAt: string;
  transactionId: string;
  /** The order line's own id; unique per book bought. */
  itemId: string;
  /** When the line was refunded; null if it never was. */
  refundedAt: string | null;
  book: { id: string; title: string };
  country: string | null;
  status: SalesStatus;
  unitPriceCents: number;
  taxCents: number;
  feeCents: number | null;
  commissionRateBps: number | null;
  commissionCents: number;
  earningsCents: number;
  commissionAtSaleCents: number;
  commissionReversedCents: number;
  earningsAtSaleCents: number;
  earningsReversedCents: number;
  refundedCents: number;
  split: 'done' | 'pending' | 'no_rate';
};

export type SalesPage = {
  lines: SalesLine[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

export type OrdersPage = {
  orders: Array<{ transactionId: string; paidAt: string; lines: SalesLine[] }>;
  pagination: SalesPage['pagination'];
};

export type MediaType = 'ebook' | 'audiobook';

/** Server-derived publisher-facing status of a book. */
export type BookStatus = 'draft' | 'processing' | 'ready' | 'published' | 'archived' | 'withdrawn';

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
  /** The 480 px thumbnail of an uploaded cover; null when there is no uploaded cover. */
  coverThumbUrl: string | null;
  publishedAt: string | null;
  isAvailable: boolean;
  mediaType: MediaType;
  durationSeconds: number | null;
  status: BookStatus;
  /** Whether the server would allow a permanent delete right now (never sold, off sale). */
  canDelete: boolean;
  /** The newest upload, whatever its state; null if nothing was ever uploaded. */
  latestAsset: { state: AssetState; reasonCode: string | null } | null;
  hasAsset: boolean;
  fileSizeBytes: number | null;
  metrics: { salesCount: number; totalRevenueCents: number; earningsCents: number };
  createdAt: string;
  updatedAt: string;
};

export type BookStatusFilter = 'all' | BookStatus;

export type BookSort = 'updated' | 'title' | 'copies' | 'earnings' | 'price';

export type BookInput = {
  title: string;
  author: string;
  isbn13: string | null;
  description: string | null;
  genre: string;
  language: string;
  priceCents: number;
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
  /** active = in force, scheduled = not started yet, superseded = replaced. */
  status: 'active' | 'scheduled' | 'superseded';
};

export type ContractResponse = {
  publisherId: string;
  current: CommissionRate | null;
  history: CommissionRate[];
};

export type AssetState =
  | 'uploaded'
  | 'validating'
  | 'scanning'
  | 'encrypting'
  | 'storing'
  | 'ready'
  | 'rejected'
  | 'failed';

export type BookAsset = {
  id: string;
  version: number;
  state: AssetState;
  reasonCode: string | null;
  /** Backend English text; never shown, the portal translates `reasonCode`. */
  reasonDetail: string | null;
  originalSizeBytes: number;
  isCurrent: boolean;
  createdAt: string;
  readyAt: string | null;
  activatedAt: string | null;
};
