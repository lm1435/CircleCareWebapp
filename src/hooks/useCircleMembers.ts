import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getCircleDetail, type CircleDetail, type CircleMember } from '@/api/circleMembers';
import { queryKeys } from '@/lib/queryKeys';

const EMPTY_MEMBERS: CircleMember[] = [];

/** Owner first, then care recipient, then caregivers by join date. */
function rolePriority(member: CircleMember): number {
  if (member.role === 'owner') return 0;
  if (member.is_care_recipient) return 1;
  return 2;
}

export interface UseCircleMembersResult {
  /** Sorted: owner, care recipient, then caregivers (oldest join first). */
  members: CircleMember[];
}

/**
 * React Query hook for `GET /circles/:circleId` (plan Tasks 35-36).
 * Members are derived from the circle detail response — there is no separate
 * members endpoint. Uses mobile's `['circle', circleId]` detail key verbatim.
 */
export function useCircleMembers(
  circleId: string
): UseQueryResult<CircleDetail> & UseCircleMembersResult {
  const query = useQuery({
    queryKey: queryKeys.circleDetail(circleId),
    queryFn: () => getCircleDetail(circleId),
    enabled: !!circleId,
  });

  const rawMembers = query.data?.members ?? EMPTY_MEMBERS;

  const members = useMemo(
    () =>
      [...rawMembers].sort(
        (a, b) => rolePriority(a) - rolePriority(b) || a.joined_at.localeCompare(b.joined_at)
      ),
    [rawMembers]
  );

  return { ...query, members };
}
