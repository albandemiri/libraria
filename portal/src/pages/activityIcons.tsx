import type { SVGProps } from 'react';

function Svg({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
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

/** A bag: a sale. */
export const SaleIcon = () => (
  <Svg>
    <path d="M3 5h10l-.8 8H3.8L3 5Z" />
    <path d="M5.5 5V4a2.5 2.5 0 0 1 5 0v1" />
  </Svg>
);

/** An arrow turning back: a refund. */
export const RefundIcon = () => (
  <Svg>
    <path d="M6 3 3 6l3 3" />
    <path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H7" />
  </Svg>
);

/** An open book: a catalogue update. */
export const BookIcon = () => (
  <Svg>
    <path d="M8 4.5C6.8 3.6 5 3.3 2.5 3.5v8c2.5-.2 4.3.1 5.5 1 1.2-.9 3-1.2 5.5-1v-8c-2.5-.2-4.3.1-5.5 1Z" />
    <path d="M8 4.5V12.5" />
  </Svg>
);
