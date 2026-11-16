export type NavKey = 'discover' | 'explore' | 'library' | 'lists';

export const NAV_ITEMS: ReadonlyArray<{ key: NavKey; href: string }> = [
  { key: 'discover', href: '/' },
  { key: 'explore', href: '/eksploro' },
  { key: 'library', href: '/biblioteka' },
  { key: 'lists', href: '/lista' },
];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Which destination a path belongs to. Catalogue-adjacent pages count as Eksploro. */
export function activeNav(pathname: string): NavKey | null {
  if (pathname === '/') return 'discover';
  if (['/eksploro', '/kerko', '/botues', '/libri'].some((base) => under(pathname, base))) {
    return 'explore';
  }
  if (under(pathname, '/biblioteka')) return 'library';
  if (under(pathname, '/lista')) return 'lists';
  return null;
}
