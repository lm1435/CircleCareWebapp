import type { HTMLAttributes, ReactElement } from 'react';
import {
  careCardActionBtn,
  careCardActionCompact,
  careCardActionText,
  careCardActionsInline,
  careCardActionsRow,
  careCardBadgeRow,
  careCardMeta,
  careCardShell,
  careCardTopRow,
} from './careCard';

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

/**
 * Which real card's ACTION AREA the placeholder draws (mirror of mobile's
 * `CareCardSkeletonAction`).
 *
 *   'dose' — TodaysMeds' Skip (bare label) + Confirm (filled pill) pair, INLINE
 *            at the end of the meta line; once the card's own content box is
 *            under 360px, on a right-aligned row of its own below.
 *   'task' — TaskRow's single Done pill, trailing the content row; same
 *            360px fallback to a row below.
 *
 * Both slots are rendered, exactly like the real cards, and the SAME container
 * query (`careCardActionsInline` / `careCardActionsRow` under `careCardShell`'s
 * `[container-type:inline-size]`) shows one at a time. Omitted → no action
 * area (a view-only member's card has none).
 */
export type CareCardSkeletonAction = 'dose' | 'task';

export interface CareCardSkeletonProps {
  action?: CareCardSkeletonAction;
}

// A filled action pill's placeholder: the real pill's box (`careCardActionBtn`
// + the compact Done modifier for a task), shimmer instead of fill.
function PillSkeleton({ compact = false, testId }: { compact?: boolean; testId: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      data-testid={testId}
      className={`${careCardActionBtn}${compact ? ` ${careCardActionCompact}` : ''} cc-shimmer bg-bg-3`}
    />
  );
}

// The bare-label Skip: the real button box (`careCardActionText`) around a
// text-line placeholder.
function TextActionSkeleton({ testId }: { testId: string }): ReactElement {
  return (
    <span aria-hidden="true" data-testid={testId} className={careCardActionText}>
      <Skeleton className="h-3.5 w-8" />
    </span>
  );
}

function ActionSlot({ action, slot }: { action: CareCardSkeletonAction; slot: string }): ReactElement {
  return action === 'dose' ? (
    <>
      <TextActionSkeleton testId={`care-card-skeleton-skip-${slot}`} />
      <PillSkeleton testId={`care-card-skeleton-take-${slot}`} />
    </>
  ) : (
    <PillSkeleton compact testId={`care-card-skeleton-done-${slot}`} />
  );
}

/**
 * Placeholder for ONE care card (a medication dose or a task), drawn in the
 * real card's shell — `careCardShell`: 14px inset, 1.5px border, r20 — so the
 * grey rows sit inside the same inner edge the loaded card has and nothing
 * shifts when it lands. Mirror of mobile's `CareCardSkeleton`
 * (mobile/src/components/ui/Skeleton.tsx), same rows, same order.
 *
 * The ACTION AREA uses the real cards' tokens and placement: it used to be one
 * full-width pill under the text, which no real card draws.
 */
export function CareCardSkeleton({ action }: CareCardSkeletonProps): ReactElement {
  const dose = action === 'dose';
  return (
    <div aria-hidden="true" data-testid="care-card-skeleton" className={careCardShell}>
      <div className={careCardTopRow}>
        <Skeleton className="h-[22px] w-[22px] shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-3/5" />
          {dose && (
            // The dose card's status pill row ("Overdue" / "Upcoming").
            <div className={careCardBadgeRow}>
              <Skeleton className="h-[23px] w-[72px] rounded-full" />
            </div>
          )}
          <div className={careCardMeta}>
            <Skeleton className="h-3 w-2/5" />
            {dose && (
              <span data-testid="care-card-skeleton-actions-inline" className={careCardActionsInline}>
                <ActionSlot action="dose" slot="inline" />
              </span>
            )}
          </div>
        </div>
        {action === 'task' && (
          <div data-testid="care-card-skeleton-actions-inline" className={careCardActionsInline}>
            <ActionSlot action="task" slot="inline" />
          </div>
        )}
      </div>
      {action && (
        <div data-testid="care-card-skeleton-actions-row" className={careCardActionsRow}>
          <ActionSlot action={action} slot="row" />
        </div>
      )}
    </div>
  );
}
