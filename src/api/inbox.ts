import { apiClient } from '@/lib/api';
import type { InboxItem } from '@/lib/notificationsInbox';

// Notifications inbox (contract: /api/inbox, requireAuth).
//   GET  /inbox[?circle_id=]  -> { success, data: { items, unread_count } }
//        (with circle_id, both the items and unread_count are that circle's only)
//   GET  /inbox/unread-count  -> { success, data: { unread_count, by_circle } }
//        (by_circle: { [circleId]: n } for circles with n > 0; an OLD backend omits it)
//   POST /inbox/read          body { ids: uuid[] } | { all: true } | { all: true, circle_id }
//                             -> { data: { updated } }
// The api client's response interceptor unwraps to the `{ success, data }` envelope.

export interface InboxList {
  items: InboxItem[];
  unread_count: number;
}

export interface InboxUnread {
  unread_count: number;
  /**
   * Unread per circle (only circles with a count > 0). `null` means UNKNOWN: an
   * older backend that does not send it. Callers fall back (a scoped bell shows the
   * total; circle cards show nothing), never treat null as "zero everywhere".
   */
  by_circle: Record<string, number> | null;
}

export type MarkInboxReadInput =
  | { ids: string[] }
  | { all: true }
  | { all: true; circle_id: string };

export async function getInbox(circleId?: string): Promise<InboxList> {
  const response = (await (circleId
    ? apiClient.get('/inbox', { params: { circle_id: circleId } })
    : apiClient.get('/inbox'))) as unknown as {
    data: { items?: InboxItem[]; unread_count?: number };
  };
  return {
    items: response.data.items ?? [],
    unread_count: response.data.unread_count ?? 0,
  };
}

export async function getInboxUnread(): Promise<InboxUnread> {
  const response = (await apiClient.get('/inbox/unread-count')) as unknown as {
    data: { unread_count?: number; by_circle?: Record<string, number> | null };
  };
  const byCircle = response.data.by_circle;
  return {
    unread_count: response.data.unread_count ?? 0,
    by_circle: byCircle && typeof byCircle === 'object' ? byCircle : null,
  };
}

export async function markInboxRead(input: MarkInboxReadInput): Promise<number> {
  const response = (await apiClient.post('/inbox/read', input)) as unknown as {
    data: { updated?: number };
  };
  return response.data.updated ?? 0;
}
