import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  getInbox,
  getInboxUnread,
  markInboxRead,
  type InboxList,
  type InboxUnread,
  type MarkInboxReadInput,
} from '@/api/inbox';
import { isInboxEnabled } from '@/lib/notificationsInbox';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';

// Notifications inbox hooks. Every hook is gated on the `notifications_inbox`
// flag AND a signed-in session: flag off => no request is ever made.

/** Modest polling for the bell badge; window focus refetches too. */
export const UNREAD_POLL_MS = 60_000;

/**
 * The inbox list. With `circleId`, that circle's rows only (GET /inbox?circle_id=),
 * under its own key so it never shows another scope's cached rows.
 */
export function useInbox(circleId?: string): UseQueryResult<InboxList> {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: circleId ? queryKeys.inboxForCircle(circleId) : queryKeys.inbox,
    queryFn: () => getInbox(circleId),
    enabled: isInboxEnabled() && isAuthenticated,
    // Opening the page always shows fresh rows.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

function useUnreadQuery<T>(select: (data: InboxUnread) => T): UseQueryResult<T> {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: queryKeys.inboxUnread,
    queryFn: getInboxUnread,
    enabled: isInboxEnabled() && isAuthenticated,
    refetchOnWindowFocus: true,
    refetchInterval: UNREAD_POLL_MS,
    select,
  });
}

const selectTotal = (data: InboxUnread): number => data.unread_count;
const selectSummary = (data: InboxUnread): InboxUnread => data;

/** The account-wide unread total (the bell outside a circle). */
export function useInboxUnreadCount(): UseQueryResult<number> {
  return useUnreadQuery(selectTotal);
}

/**
 * The total plus the per-circle split (`by_circle`, null on an older backend).
 * Same query as `useInboxUnreadCount`: one request feeds both.
 */
export function useInboxUnreadSummary(): UseQueryResult<InboxUnread> {
  return useUnreadQuery(selectSummary);
}

interface MarkContext {
  previousLists: Array<[QueryKey, InboxList | undefined]>;
  previousUnread: InboxUnread | undefined;
}

/**
 * Mark rows read (`{ ids }`), everything (`{ all: true }`) or one circle's rows
 * (`{ all: true, circle_id }`), optimistically. Only rows inside the scope change,
 * in every cached list (the all-circles list and each circle's), and the unread
 * summary drops by exactly what was read in that scope.
 */
export function useMarkInboxRead(): UseMutationResult<number, Error, MarkInboxReadInput, MarkContext> {
  const queryClient = useQueryClient();
  return useMutation<number, Error, MarkInboxReadInput, MarkContext>({
    mutationFn: (input) => markInboxRead(input),
    onMutate: async (input) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: queryKeys.inbox }),
        queryClient.cancelQueries({ queryKey: queryKeys.inboxUnread }),
      ]);
      const previousLists = queryClient.getQueriesData<InboxList>({ queryKey: queryKeys.inbox });
      const previousUnread = queryClient.getQueryData<InboxUnread>(queryKeys.inboxUnread);
      const now = new Date().toISOString();
      const ids = 'ids' in input ? new Set(input.ids) : null;
      const scopeCircle = 'circle_id' in input ? input.circle_id : null;
      const inScope = (item: InboxList['items'][number]): boolean =>
        ids ? ids.has(item.id) : scopeCircle ? item.circle_id === scopeCircle : true;

      // Rows newly read, by id (deduped across lists) -> their circle.
      const newlyRead = new Map<string, string | null>();
      for (const [key, list] of previousLists) {
        if (!list) continue;
        let readHere = 0;
        const items = list.items.map((item) => {
          if (item.read_at || !inScope(item)) return item;
          readHere += 1;
          newlyRead.set(item.id, item.circle_id ?? null);
          return { ...item, read_at: now };
        });
        // A circle's own list covers the whole scope of an all-for-that-circle mark.
        const scopeIsThisList = !ids && (scopeCircle === null || key[1] === scopeCircle);
        queryClient.setQueryData<InboxList>(key, {
          items,
          unread_count: scopeIsThisList ? 0 : Math.max(0, list.unread_count - readHere),
        });
      }

      if (previousUnread) {
        let next: InboxUnread;
        if (!ids && scopeCircle === null) {
          next = { unread_count: 0, by_circle: previousUnread.by_circle ? {} : null };
        } else if (!ids && scopeCircle !== null) {
          const byCircle = previousUnread.by_circle;
          const known = byCircle ? (byCircle[scopeCircle] ?? 0) : null;
          const drop = known ?? [...newlyRead.values()].filter((c) => c === scopeCircle).length;
          next = {
            unread_count: Math.max(0, previousUnread.unread_count - drop),
            by_circle: byCircle ? withoutCircle(byCircle, scopeCircle) : null,
          };
        } else {
          let byCircle = previousUnread.by_circle ? { ...previousUnread.by_circle } : null;
          if (byCircle) {
            for (const circle of newlyRead.values()) {
              if (!circle || !byCircle[circle]) continue;
              byCircle[circle] -= 1;
              if (byCircle[circle] <= 0) byCircle = withoutCircle(byCircle, circle);
            }
          }
          next = {
            unread_count: Math.max(0, previousUnread.unread_count - newlyRead.size),
            by_circle: byCircle,
          };
        }
        queryClient.setQueryData<InboxUnread>(queryKeys.inboxUnread, next);
      }
      return { previousLists, previousUnread };
    },
    onError: (_error, _input, context) => {
      for (const [key, list] of context?.previousLists ?? []) {
        if (list) queryClient.setQueryData(key, list);
      }
      if (context?.previousUnread) {
        queryClient.setQueryData(queryKeys.inboxUnread, context.previousUnread);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inbox });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inboxUnread });
    },
  });
}

function withoutCircle(byCircle: Record<string, number>, circleId: string): Record<string, number> {
  const next = { ...byCircle };
  delete next[circleId];
  return next;
}
