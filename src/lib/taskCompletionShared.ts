import type { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

/** Refetch every list that draws a task row. */
export function invalidateTaskQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string
): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks(circleId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.calendarEvents(circleId) }),
  ]);
}

/** `task_complete:${circle}:${root}:${date}`: one queue entry per occurrence. */
export const retryKeyOf = (job: { circleId: string; target: { eventId: string; scheduledDate?: string } }): string =>
  `task_complete:${job.circleId}:${job.target.eventId}:${job.target.scheduledDate ?? ''}`;

