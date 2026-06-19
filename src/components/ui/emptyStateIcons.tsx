import type { ReactElement } from 'react';

interface IconProps {
  size?: number;
}

function Svg({ size = 26, children }: { size?: number; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Overlapping circles — circle-of-care motif for the empty circle picker. */
export function CirclesIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <circle cx="9" cy="9" r="5" />
      <circle cx="15" cy="15" r="5" />
    </Svg>
  );
}

/** Folder — documents empty state. */
export function FolderIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M4 5h5l2 2.5h9a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

/** Pulse / activity line — activity feed empty state. */
export function ActivityIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M3 12h4l2-6 4 12 2-6h6" />
    </Svg>
  );
}

/** Cross-in-shield — emergency info empty states. */
export function EmergencyIcon({ size }: IconProps): ReactElement {
  return (
    <Svg size={size}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="M12 8v6M9 11h6" />
    </Svg>
  );
}
