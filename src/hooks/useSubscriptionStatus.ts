import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getSubscriptionStatus, type SubscriptionStatus } from '@/api/subscriptionStatus';
import { queryKeys } from '@/lib/queryKeys';

/**
 * React Query hook for GET /subscription-status (plan Task 39b).
 * Drives the persistent `needsCircleSelection` banner — web does NOT
 * implement the downgrade circle-selection flow (app-only).
 */
export function useSubscriptionStatus(): UseQueryResult<SubscriptionStatus> {
  return useQuery({
    queryKey: queryKeys.subscriptionStatus,
    queryFn: getSubscriptionStatus,
  });
}
