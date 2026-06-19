import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/activityFeed.ts for the web companion (Task 27).
// Endpoint truth (backend/src/routes/activityFeed.ts):
//   GET /circles/:circleId/activity?limit=<1..100>&offset=<0..>
//   → { success, data: { activities: [...], count, hasMore } }
// - limit defaults to 50 server-side and is clamped to 1..100.
// - hasMore is the backend heuristic `activities.length === limit`.
// - `created_at` is a UTC ISO timestamp — always format viewer-local via
//   Intl/`timeZone`-aware helpers; NEVER `.split('T')[0]`.
// - For medication confirmations, the backend merges the event's
//   `scheduled_date` (YYYY-MM-DD in the care recipient's timezone) into
//   `metadata.scheduled_date`.

export interface ActivityActor {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
}

export interface ActivityMetadata {
  scheduled_date?: string;
  [key: string]: unknown;
}

export interface ActivityFeedItem {
  id: string;
  circle_id: string;
  actor_id?: string | null;
  action_type: string;
  subject_type?: string | null;
  subject_id?: string | null;
  description: string;
  metadata?: ActivityMetadata | null;
  created_at: string; // UTC ISO timestamp
  /** Populated actor information (null/absent for system entries). */
  actor?: ActivityActor | null;
}

export interface GetActivityFeedParams {
  limit?: number;
  offset?: number;
}

export interface ActivityFeedPage {
  activities: ActivityFeedItem[];
  hasMore: boolean;
}

interface ActivityFeedEnvelope {
  success: boolean;
  data: {
    activities: ActivityFeedItem[];
    count: number;
    hasMore: boolean;
  };
}

export async function getActivityFeed(
  circleId: string,
  params?: GetActivityFeedParams
): Promise<ActivityFeedPage> {
  // The api client's response interceptor unwraps to the `{ success, data }` envelope.
  const response = (await apiClient.get(`/circles/${circleId}/activity`, {
    params,
  })) as unknown as ActivityFeedEnvelope;

  return {
    activities: response.data.activities ?? [],
    hasMore: response.data.hasMore ?? false,
  };
}
