import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: P) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon=""
      {...rest}
    >
      {children}
    </svg>
  );
}

export const CheckIcon = (p: P) => (
  <Svg {...p}>
    <path d="m2.5 6.3 2.2 2.2 4.8-5" />
  </Svg>
);
export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="4.2" />
    <path d="M6 3.7V6l1.5 1" />
  </Svg>
);
export const CrossIcon = (p: P) => (
  <Svg {...p}>
    <path d="m3 3 6 6M9 3 3 9" />
  </Svg>
);
export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="4.2" />
    <path d="M6 5.5V8.5M6 3.8v.1" />
  </Svg>
);
export const DashIcon = (p: P) => (
  <Svg {...p}>
    <path d="M3 6h6" />
  </Svg>
);
export const SortIcon = ({ dir, ...p }: P & { dir?: 'asc' | 'desc' }) => (
  <Svg {...p}>
    <path d="M6 2.5v7M3.5 5 6 2.5 8.5 5" opacity={dir === 'desc' ? 0.25 : 1} />
    <path d="M3.5 7 6 9.5 8.5 7" opacity={dir === 'asc' ? 0.25 : 1} />
  </Svg>
);
export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="5.2" cy="5.2" r="3.2" />
    <path d="m7.8 7.8 2.2 2.2" />
  </Svg>
);
export const UploadIcon = (p: P) => (
  <Svg width="20" height="20" {...p}>
    <path d="M6 8.5v-6M3.8 4.5 6 2.3l2.2 2.2M2.5 9.5h7" />
  </Svg>
);

export const MoreIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="2.5" cy="6" r="0.9" fill="currentColor" />
    <circle cx="6" cy="6" r="0.9" fill="currentColor" />
    <circle cx="9.5" cy="6" r="0.9" fill="currentColor" />
  </Svg>
);
