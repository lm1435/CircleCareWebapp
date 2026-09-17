import { useMemo } from 'react';
import { useCircles } from '@/hooks/useCircles';
import { useCircleMembers } from '@/hooks/useCircleMembers';
import type { Circle, CircleAccessLevel } from '@/api/circles';
import type { CircleDetail, CircleMember } from '@/api/circleMembers';

// Single-circle convenience hook (plan Stage 0, Task 0.5).
//
// Composes the two existing fetchers — does NOT add a new query/key:
//   - useCircleMembers(circleId) → GET /circles/:circleId (CircleDetail) which
//     carries `care_recipient_timezone`, `members`, and the requester's gating
//     flags (`can_edit`, `access_level`, `view_only`, `is_premium_circle`).
//   - useCircles() → GET /circles (Circle[]) which additionally carries the
//     list-only gating flag `read_only` (non-selected free-tier circle), not
//     present on the detail response.
//
// `is_premium_circle` IS ON THE DETAIL RESPONSE. This comment used to say it
// was list-only, and so did three other places; it was wrongly grouped with
// `read_only`, which genuinely is. `backend/src/routes/circles.ts` puts it on
// GET /circles/:circleId and `api/circleMembers.ts` has always typed it on
// `CircleDetail`. That false belief is why the AI gate was built on `can_edit`
// instead — see `src/lib/aiAccess.ts`.
//
// Every write form needs the resolved timezone + gating in one shape; this hook
// is that source so forms don't re-derive it.

/** America/New_York is the documented timezone fallback for null/missing TZ. */
const DEFAULT_TIMEZONE = 'America/New_York';
const EMPTY_MEMBERS: CircleMember[] = [];

export interface UseCircleResult {
  /** Full circle detail (timezone, members, recipient fields, gating). */
  circle: CircleDetail | undefined;
  /** Matching list-level circle (adds `read_only`). */
  circleSummary: Circle | undefined;
  /**
   * The care recipient's timezone, or `null` WHILE THE CIRCLE IS STILL LOADING.
   *
   * The null is the whole point. This used to be a plain `string` that fell
   * back to 'America/New_York' unconditionally, which made "still loading"
   * indistinguishable from "the recipient really does live in New York". Any
   * consumer that computed a DATE from it before the detail query resolved got
   * a New-York-anchored answer, then a DIFFERENT answer once the real zone
   * arrived — two renders, two different "today"s, and two of whatever request
   * that date keyed. `GettingStartedChecklist` fired its 211-day presence read
   * twice (two windows one day apart whenever New York and the recipient's zone
   * straddle midnight); the e2e spec
   * `e2e/unhappy/writes/home-events-requests.spec.ts` ("exactly one presence
   * read") is what caught it.
   *
   * So: date math MUST GATE on this being non-null (render a loading state,
   * or pass empty dates so the query stays disabled — see `TodaysMeds`).
   * `?? 'America/New_York'` at the call site just re-creates the bug under a
   * different name. Once the circle HAS loaded, the documented
   * 'America/New_York' fallback still applies for a circle with no zone set —
   * that value is a real answer, not a placeholder for an unknown one.
   */
  timezone: string | null;
  /** Sorted members (owner, care recipient, then caregivers by join date). */
  members: CircleMember[];
  /** Requester can perform write actions on this circle. */
  canEdit: boolean;
  /** Requester's subscription-aware access level (full | edit | view). */
  accessLevel: CircleAccessLevel | undefined;
  /**
   * "Premium benefits apply TO ME in this circle" — NOT "this circle is
   * premium". The server computes it per MEMBERSHIP and hardcodes it `false`
   * for a view-only seat before it ever reads the owner's tier, so always test
   * `viewOnly` before this. The AI entry gate (`lib/aiAccess.ts`) reads it, and
   * so does mobile's `useAIEntryAccess`.
   */
  isPremiumCircle: boolean;
  /** Membership-level view-only (freemium caregiver cap). */
  viewOnly: boolean;
  /** Non-selected free-tier circle (read-only). From the list response only. */
  readOnly: boolean;
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
}

export function useCircle(circleId: string): UseCircleResult {
  const detailQuery = useCircleMembers(circleId);
  const circlesQuery = useCircles();

  const circle = detailQuery.data;

  const circleSummary = useMemo(
    () => circlesQuery.data?.find((c) => c.id === circleId),
    [circlesQuery.data, circleId]
  );

  return {
    circle,
    circleSummary,
    // `circle ? … : null` — NOT `circle?.… || DEFAULT`. See `UseCircleResult`.
    // Mirrors `useCareRecipientTimezone` in hooks/useCalendarEvents.ts.
    timezone: circle ? circle.care_recipient_timezone || DEFAULT_TIMEZONE : null,
    members: detailQuery.members ?? EMPTY_MEMBERS,
    canEdit: circle?.can_edit ?? false,
    accessLevel: circle?.access_level,
    isPremiumCircle: circle?.is_premium_circle ?? false,
    viewOnly: circle?.view_only ?? false,
    readOnly: circleSummary?.read_only ?? false,
    // The summary is supplementary (read_only only); the detail query is the
    // source of truth for loading/error of THIS circle — and for every gating
    // flag except `read_only`.
    isLoading: detailQuery.isLoading,
    isError: detailQuery.isError,
    refetch: () => {
      void detailQuery.refetch();
      void circlesQuery.refetch();
    },
  };
}
