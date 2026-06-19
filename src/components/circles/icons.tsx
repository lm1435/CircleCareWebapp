import type { ReactElement } from 'react';

interface IconProps {
  size?: number;
}

/** Inline lock icon for "Read-only" badges. Decorative — badge text carries meaning. */
export function LockIcon({ size = 12 }: IconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

/** Filled heart — care-recipient overlay badge. Decorative; aria-label carries meaning. */
export function HeartIcon({ size = 11 }: IconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 21s-7.5-4.6-10-9.3C.6 8.4 2.2 5 5.5 5c2 0 3.4 1.2 4.2 2.4l.3.4.3-.4C11.1 6.2 12.5 5 14.5 5 17.8 5 19.4 8.4 22 11.7 19.5 16.4 12 21 12 21Z" />
    </svg>
  );
}

/** Filled bell — medication-responsible overlay badge. Decorative; aria-label carries meaning. */
export function BellIcon({ size = 11 }: IconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d="M12 2a6 6 0 0 0-6 6c0 4-1.5 5.5-2.5 6.5-.4.4-.1 1.1.5 1.1h16c.6 0 .9-.7.5-1.1C19.5 13.5 18 12 18 8a6 6 0 0 0-6-6Z" />
      <path d="M10 19a2 2 0 0 0 4 0Z" />
    </svg>
  );
}

/** Inline eye icon for "View Only" badges. Decorative — badge text carries meaning. */
export function EyeIcon({ size = 12 }: IconProps): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
