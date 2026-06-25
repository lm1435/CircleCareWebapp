import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  getSubscriptionStatus,
  selectDowngradeCircle,
  type SubscriptionStatus,
} from '@/api/subscriptionStatus';
import { queryKeys } from '@/lib/queryKeys';

/**
 * React Query hook for GET /subscription-status (plan Task 39b).
 * Drives the persistent `needsCircleSelection` banner + the web circle-selection
 * flow.
 */
export function useSubscriptionStatus(): UseQueryResult<SubscriptionStatus> {
  return useQuery({
    queryKey: queryKeys.subscriptionStatus,
    queryFn: getSubscriptionStatus,
  });
}

/**
 * Pick the circle to keep after a downgrade (owner of 2+ circles). On success,
 * `needsCircleSelection` flips to false and read-only flags settle, so we
 * invalidate subscription-status + circles to refresh the UI.
 */
export function useSelectDowngradeCircle(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (circleId: string) => selectDowngradeCircle(circleId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.circles }),
      ]);
    },
  });
}
