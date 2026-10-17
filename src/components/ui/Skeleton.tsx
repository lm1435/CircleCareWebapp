import type { HTMLAttributes, ReactElement } from 'react';
import { careCardShell } from './careCard';

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

export interface CareCardSkeletonProps {
  /** Draw the action pill under the content (the dose card's Take/Skip row). */
  withAction?: boolean;
}

/**
 * Placeholder for ONE care card (a medication dose or a task), drawn in the
 * real card's shell — `careCardShell`: 14px inset, 1.5px border, r20 — so the
 * grey rows sit inside the same inner edge the loaded card has and nothing
 * shifts when it lands. Mirror of mobile's `CareCardSkeleton`
 * (mobile/src/components/ui/Skeleton.tsx), same rows, same order.
 */
export function CareCardSkeleton({ withAction = false }: CareCardSkeletonProps): ReactElement {
  return (
    <div aria-hidden="true" data-testid="care-card-skeleton" className={careCardShell}>
      <div className="flex items-center gap-3">
        <Skeleton className="h-[22px] w-[22px] shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="mt-1 h-3 w-2/5" />
        </div>
      </div>
      {withAction && <Skeleton className="mt-3 h-11 w-full rounded-full" />}
    </div>
  );
}
