import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  getTasks,
  type GetTasksResponse,
  type TaskSort,
  type TaskStatus,
} from '@/api/tasks';
import { queryKeys } from '@/lib/queryKeys';

// PORT of mobile/src/hooks/useTasks.ts (read hook only). Task COMPLETION is NOT
// here — it reuses `useCompleteEvent` from useCalendarEvents.ts (parity with
// mobile, which completes via completeEvent).

export interface UseTasksOptions {
  status?: TaskStatus;
  sort?: TaskSort;
  limit?: number;
}

/**
 * React Query read hook for GET /circles/:circleId/tasks. Mirrors mobile's
 * `useTasks`: the query key only includes DEFINED params (via
 * `queryKeys.tasksList`) so it stays a superset of `queryKeys.tasks(circleId)`
 * and event write hooks invalidating that prefix still match.
 */
export function useTasks(
  circleId: string,
  opts?: UseTasksOptions
): UseQueryResult<GetTasksResponse> {
  return useQuery({
    queryKey: queryKeys.tasksList(circleId, opts),
    queryFn: () => getTasks(circleId, opts),
    enabled: !!circleId,
    staleTime: 1000 * 60, // 1 min (mirrors mobile)
  });
}
