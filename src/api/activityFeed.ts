import { apiClient } from '@/lib/api';

// PORT of mobile/src/api/activityFeed.ts for the web companion (Task 27).
// Endpoint truth (backend/src/routes/activityFeed.ts):
//   GET /circles/:circleId/activity?limit=<1..100>&offset=<0..>
//   → { success, data: { activities: [...], count, hasMore } }
// - limit defaults to 50 server-side and is clamped to 1..100.
// - hasMore is the backend heuristic `activities.length === limit`. The backend
//   never drops rows (activities.length is the raw page length); note rows whose
//   note is gone come back flagged `note_missing` and are hidden at render time.
// - `created_at` is a UTC ISO timestamp — always format viewer-local via
//   Intl/`timeZone`-aware helpers; NEVER `.split('T')[0]`.
// - For medication confirmations, the backend merges the event's
//   `scheduled_date` (YYYY-MM-DD in the care recipient's timezone) into
//   `metadata.scheduled_date`.

export interface ActivityActor {
  id: string;
  /**
   * ABSENT for a person who has left the circle: the backend then fills the
   * embed with `{ id, first_name, last_name }` only (backend
   * utils/userDisplayNames.ts), never their email. Read the name first.
   */
  email?: string | null;
  first_name: string | null;
  last_name: string | null;
}

export interface ActivityMetadata {
  scheduled_date?: string;
  [key: string]: unknown;
}

/**
 * Where a note-feed row's note lives — Slice 2 (notes-first-class plan, Task
 * 8's backend contract). `event_id` is the SERIES ROOT id (`parent_event_id
 * ?? id`), never the physical/virtual instance the note was actually
 * attached to, so the web link always lands on the right week even for a
 * recurring series.
 */
export interface ActivityNoteTargetEvent {
  kind: 'event';
  event_id: string;
  scheduled_date: string;
  event_type: string;
  event_title: string;
}

export interface ActivityNoteTargetCare {
  kind: 'care';
  note_date: string;
}

export type ActivityNoteTarget = ActivityNoteTargetEvent | ActivityNoteTargetCare;

export interface ActivityFeedItem {
  id: string;
  circle_id: string;
  actor_id?: string | null;
  action_type: string;
  subject_type?: string | null;
  subject_id?: string | null;
  description: string;
  /**
   * Stable key for what this row says, e.g. 'entries.memberJoined.caregiver'.
   * Stored WITHOUT a namespace prefix, so it resolves verbatim inside the
   * `activity` i18n namespace. Null on rows written before parameterization
   * shipped and on write sites not yet parameterized. Render via
   * `renderActivityDescription`, never by passing the key straight to t().
   */
  description_key?: string | null;
  /** RAW interpolation values: 'HH:MM:SS' times, 'YYYY-MM-DD' dates, titles,
   *  emails/names. Never pre-formatted, never an English token. */
  description_params?: Record<string, unknown> | null;
  metadata?: ActivityMetadata | null;
  created_at: string; // UTC ISO timestamp
  /** Populated actor information (null/absent for system entries). */
  actor?: ActivityActor | null;
  /**
   * Notes-first-class (Slice 2): whitespace-collapsed, ≤140-char note body —
   * read LIVE at feed-read time, never copied into the row. Present only on
   * `subject_type IN ('event_note', 'care_note')` rows whose note still
   * exists; `null` for a mood-only care note. Absent on every other row and
   * on old `subject_type: 'event'` note rows (no backfill — plan decision 3).
   */
  note_preview?: string | null;
  /** Deep-link target for a note row that carries `note_preview`. Absent on
   *  an old note row (not clickable) and on every non-note row. */
  note_target?: ActivityNoteTarget | null;
  /**
   * `true` on an `'event_note'`/`'care_note'` row whose note — or the event it
   * was written on — no longer exists (deleted, or the event removed); such a
   * row carries `note_preview: null` and no `note_target`. `false` on a note
   * row that resolved; absent on every other row. Feed surfaces HIDE flagged
   * rows via `visibleActivities`; the backend still returns them so the
   * page length (and so the offset math) is the raw one.
   */
  note_missing?: boolean;
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
