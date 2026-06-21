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
//     flags (`can_edit`, `access_level`, `view_only`).
//   - useCircles() → GET /circles (Circle[]) which additionally carries the
//     list-only gating flags `read_only` (non-selected free-tier circle) and
//     `is_premium_circle`, not present on the detail response.
//
// Every write form needs the resolved timezone + gating in one shape; this hook
// is that source so forms don't re-derive it.

/** America/New_York is the documented timezone fallback for null/missing TZ. */
const DEFAULT_TIMEZONE = 'America/New_York';
const EMPTY_MEMBERS: CircleMember[] = [];

export interface UseCircleResult {
  /** Full circle detail (timezone, members, recipient fields, gating). */
  circle: CircleDetail | undefined;
  /** Matching list-level circle (adds `read_only`/`is_premium_circle`). */
  circleSummary: Circle | undefined;
  /** care_recipient_timezone || 'America/New_York' — safe for date/time math. */
  timezone: string;
  /** Sorted members (owner, care recipient, then caregivers by join date). */
  members: CircleMember[];
  /** Requester can perform write actions on this circle. */
  canEdit: boolean;
  /** Requester's subscription-aware access level (full | edit | view). */
  accessLevel: CircleAccessLevel | undefined;
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
    timezone: circle?.care_recipient_timezone || DEFAULT_TIMEZONE,
    members: detailQuery.members ?? EMPTY_MEMBERS,
    canEdit: circle?.can_edit ?? false,
    accessLevel: circle?.access_level,
    viewOnly: circle?.view_only ?? false,
    readOnly: circleSummary?.read_only ?? false,
    // The summary is supplementary (read_only/is_premium_circle only); the
    // detail query is the source of truth for loading/error of THIS circle.
    isLoading: detailQuery.isLoading,
    isError: detailQuery.isError,
    refetch: () => {
      void detailQuery.refetch();
      void circlesQuery.refetch();
    },
  };
}
