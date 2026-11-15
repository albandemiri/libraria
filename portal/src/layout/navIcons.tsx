import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: P) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

const overview = (
  <>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </>
);
const catalog = (
  <>
    <path d="M3 2.5h7a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2z" />
    <path d="M3 11.5a2 2 0 0 1 2-2h7" />
  </>
);
const sales = (
  <>
    <path d="M2 3h2l1.5 7h6.5l1.5-5H4.7" />
    <circle cx="6.5" cy="12.8" r=".6" />
    <circle cx="11.5" cy="12.8" r=".6" />
  </>
);
const analytics = <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />;
const earnings = (
  <>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M10 6.2C9.6 5.6 8.9 5.3 8 5.3c-1.1 0-1.9.6-1.9 1.4 0 2 3.9.8 3.9 2.8 0 .9-.9 1.5-2 1.5-.9 0-1.7-.3-2.1-1M8 4v8" />
  </>
);
const transactions = <path d="M3 5.5h9.5L10.5 3.5M13 10.5H3.5l2 2" />;
const payouts = (
  <>
    <rect x="2" y="4" width="12" height="8.5" rx="1.5" />
    <path d="M2 7h12M4.5 10h2" />
  </>
);
const statements = (
  <>
    <path d="M4 2h6l2.5 2.5V14H4z" />
    <path d="M6 7.5h4M6 10h4" />
  </>
);
const contracts = (
  <>
    <path d="M4 2h6l2.5 2.5V14H4z" />
    <path d="M6 11c.8-1.2 1.4-.2 2 0s1.2.4 2-.5" />
  </>
);
const settings = (
  <>
    <path d="M2.5 4.5h5M10.5 4.5h3M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="9" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </>
);

const ICONS = {
  overview,
  catalog,
  sales,
  analytics,
  earnings,
  transactions,
  payouts,
  statements,
  contracts,
  settings,
};
export type NavIconName = keyof typeof ICONS;

export const NavIcon = ({ name, ...p }: P & { name: NavIconName }) => (
  <Svg {...p}>{ICONS[name]}</Svg>
);

export const MenuIcon = (p: P) => (
  <Svg {...p}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Svg>
);
export const CollapseIcon = ({ flipped, ...p }: P & { flipped?: boolean }) => (
  <Svg {...p}>
    <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
    <path d="M6 2.5v11" />
    <path d={flipped ? 'm9.5 6.5 1.5 1.5-1.5 1.5' : 'm11 6.5-1.5 1.5 1.5 1.5'} />
  </Svg>
);
