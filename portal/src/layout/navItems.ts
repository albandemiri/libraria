import type { NavIconName } from './navIcons';

export type NavItem = { to: string; key: NavIconName; end?: boolean };
export type NavGroup = {
  key: 'workspace' | 'financials' | 'organization' | 'platform';
  items: NavItem[];
  /** Shown to admin accounts only. The routes are guarded separately. */
  adminOnly?: boolean;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'workspace',
    items: [
      { to: '/', key: 'overview', end: true },
      { to: '/catalog', key: 'catalog' },
      { to: '/sales', key: 'sales' },
      { to: '/analytics', key: 'analytics' },
    ],
  },
  {
    key: 'financials',
    items: [
      { to: '/earnings', key: 'earnings' },
      { to: '/transactions', key: 'transactions' },
      { to: '/payouts', key: 'payouts' },
      { to: '/statements', key: 'statements' },
    ],
  },
  {
    key: 'organization',
    items: [
      { to: '/contracts', key: 'contracts' },
      { to: '/settings', key: 'settings' },
    ],
  },
  {
    key: 'platform',
    adminOnly: true,
    items: [
      { to: '/platform', key: 'platform', end: true },
      { to: '/platform/publishers', key: 'publishers' },
      { to: '/platform/books', key: 'platformBooks' },
      { to: '/platform/readers', key: 'readers' },
    ],
  },
];

/** Pages driven by the shared `?from&to` date range (the Catalog list and Contracts are not). */
const RANGE_PAGES = new Set(['', 'sales', 'analytics', 'earnings', 'transactions']);

const firstSegment = (pathname: string) => pathname.split('/')[1] ?? '';

/** A book's Sales and Analytics tabs follow the range too: /catalog/:id/sales|analytics. */
const BOOK_RANGE_TAB = /^\/catalog\/[^/]+\/(sales|analytics)\/?$/;

/** Only the Platform overview follows the range; the other Platform pages do not. */
const PLATFORM_OVERVIEW = /^\/platform\/?$/;

export const usesDateRange = (pathname: string) =>
  RANGE_PAGES.has(firstSegment(pathname)) ||
  BOOK_RANGE_TAB.test(pathname) ||
  PLATFORM_OVERVIEW.test(pathname);
