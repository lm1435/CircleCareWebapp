import type { HTMLAttributes, ReactElement } from 'react';

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Loading placeholder block. Size it with className (e.g. "h-4 w-32").
 * aria-hidden — pair with a Spinner or aria-busy on the loading region.
 *
 * Renders a directional shimmer (a moving highlight gradient over the bg-3
 * base) to match mobile's Skeleton sweep. The `cc-shimmer` utility owns the
 * `@keyframes cc-shimmer` animation and the `prefers-reduced-motion` fallback
 * (static tint, no motion) — both live in globals.css.
 */
export function Skeleton({ className, ...rest }: SkeletonProps): ReactElement {
  const base = 'cc-shimmer rounded-lg bg-bg-3';
  return <div aria-hidden="true" className={className ? `${base} ${className}` : base} {...rest} />;
}
