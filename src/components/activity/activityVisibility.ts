// Render-time visibility for activity-feed rows (see `note_missing` on
// ActivityFeedItem). Kept OUT of the api module on purpose: it is pure, and
// the many tests that mock the api module must not have to re-export it.
import type { ActivityFeedItem } from '@/api/activityFeed';

/**
 * True for a note row whose note (or the event it lived on) is gone. The
 * backend RETURNS such rows rather than dropping them — every row of the raw
 * page, always — because the next offset is the SUM of `activities.length`
 * over the pages fetched so far (see `useActivityFeed`). Hiding them is the
 * CLIENT's job and must happen at RENDER time via {@link visibleActivities};
 * filtering inside `queryFn`/`getNextPageParam` would bring back the
 * duplicate-row / stuck-offset bug the flag exists to fix.
 */
export function isNoteMissing(activity: Pick<ActivityFeedItem, 'note_missing'>): boolean {
  return activity.note_missing === true;
}

/** The rows a feed surface should render: the raw rows minus note-missing ones. */
export function visibleActivities<T extends Pick<ActivityFeedItem, 'note_missing'>>(
  activities: readonly T[]
): T[] {
  return activities.filter((a) => !isNoteMissing(a));
}

/**
 * True when the NEWEST fetched page added nothing renderable (every row on it
 * was note-missing) while more exist. A feed screen then fetches the next page
 * itself: nothing new rendered, so neither a scroll-driven `onEndReached`
 * (content length unchanged) nor an empty state would move it on.
 */
export function lastPageAllHidden(
  pages: readonly { activities: readonly Pick<ActivityFeedItem, 'note_missing'>[] }[] | undefined
): boolean {
  const last = pages?.[pages.length - 1];
  return !!last && last.activities.length > 0 && visibleActivities(last.activities).length === 0;
}
