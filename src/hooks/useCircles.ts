import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getCircles, type Circle } from '@/api/circles';
import { queryKeys } from '@/lib/queryKeys';

/**
 * React Query hook for `GET /circles` (plan Task 16).
 * Used by the header circle switcher and the circle picker page.
 */
export function useCircles(): UseQueryResult<Circle[]> {
  return useQuery({
    queryKey: queryKeys.circles,
    queryFn: getCircles,
  });
}
