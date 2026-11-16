export interface StorefrontFilters {
  genre?: string;
  search?: string;
  publisherIds?: string[];
  language?: string;
  minPrice?: number;
  maxPrice?: number;
  publishedSince?: Date;
  hideOwned?: boolean;
}

/** Whether the viewer holds an active entitlement to the book (`b` must be in scope). */
export function ownedSql(viewerParam: string): string {
  return `EXISTS (SELECT 1 FROM entitlements e
                   WHERE e.book_id = b.id AND e.user_id = ${viewerParam}::uuid
                     AND e.status = 'active')`;
}

/** Escapes LIKE metacharacters so a search for "50%" is not a wildcard. */
export function likePattern(term: string): string {
  return `%${term.replace(/([\\%_])/g, '\\$1')}%`;
}

/**
 * The WHERE conditions (without the keyword) shared by every storefront query;
 * `publishers p` and `books b` must be in scope. Placeholders are numbered from
 * `startIndex`; `params` holds their values in order. Only available ebooks are
 * ever visible.
 */
export function buildBookFilter(
  f: StorefrontFilters,
  viewerId: string | null,
  startIndex: number,
): { where: string; params: unknown[] } {
  const conditions = ["b.is_available AND b.media_type = 'ebook'"];
  const params: unknown[] = [];
  const add = (value: unknown): string => {
    params.push(value);
    return `$${startIndex + params.length - 1}`;
  };

  if (f.genre) conditions.push(`b.genre = ${add(f.genre)}`);
  if (f.search) {
    const p = add(likePattern(f.search));
    conditions.push(`(b.title ILIKE ${p} OR b.author ILIKE ${p} OR p.name ILIKE ${p})`);
  }
  if (f.publisherIds && f.publisherIds.length > 0) {
    conditions.push(`b.publisher_id = ANY(${add(f.publisherIds)}::uuid[])`);
  }
  if (f.language) conditions.push(`b.language = ${add(f.language)}`);
  if (f.minPrice !== undefined) conditions.push(`b.price_cents >= ${add(f.minPrice)}`);
  if (f.maxPrice !== undefined) conditions.push(`b.price_cents <= ${add(f.maxPrice)}`);
  if (f.publishedSince) conditions.push(`b.published_at >= ${add(f.publishedSince)}`);
  if (f.hideOwned && viewerId !== null) conditions.push(`NOT ${ownedSql(add(viewerId))}`);

  return { where: conditions.join(' AND '), params };
}
