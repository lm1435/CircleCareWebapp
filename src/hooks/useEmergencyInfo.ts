import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getEmergencyInfo, type EmergencyInfo } from '@/api/emergencyInfo';
import { queryKeys } from '@/lib/queryKeys';

/**
 * React Query hook for `GET /circles/:circleId/emergency-info` (plan Task 30).
 * Mirrors mobile/src/hooks/useEmergencyInfo.ts (read-only — web never writes).
 * Resolves to null when the circle has no emergency info yet.
 */
export function useEmergencyInfo(
  circleId: string | undefined
): UseQueryResult<EmergencyInfo | null> {
  return useQuery({
    queryKey: queryKeys.emergencyInfo(circleId ?? ''),
    queryFn: () => getEmergencyInfo(circleId as string),
    enabled: !!circleId, // Only fetch when circleId is available
  });
}
