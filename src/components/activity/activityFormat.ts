import type { ActivityActor } from '@/api/activityFeed';
import { getDateInTimezone, getDeviceTimezone } from '@/utils/timezone';

// Formatting helpers mirroring mobile/src/screens/activity/ActivityFeedScreen.tsx
// (getActorName / formatTime / formatDate / formatDateShort), adapted to the
// web convention: activity `created_at` is a UTC ISO timestamp and is shown
// VIEWER-LOCAL via Intl with an explicit timeZone (never `.split('T')[0]`,
// never bare Date getters for date keys).

type TFn = (key: string, opts?: Record<string, unknown>) => string;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Display name for an activity actor — falls back to email prefix, then "System". */
export function getActorName(actor: ActivityActor | null | undefined, t: TFn): string {
  if (!actor) return t('system');
  if (actor.first_name) return `${actor.first_name} ${actor.last_name || ''}`.trim();
  return actor.email?.split('@')[0] || t('system');
}

/**
 * Viewer-local YYYY-MM-DD day key for a UTC ISO timestamp.
 * Used to group the feed by day (mobile groups by device-local date).
 */
export function getLocalDateKey(isoString: string, timezone: string = getDeviceTimezone()): string {
  return getDateInTimezone(timezone, new Date(isoString));
}

/**
 * Relative timestamp matching mobile's formatTime: "just now", "{n}m ago",
 * "{n}h ago", "{n}d ago", then a short viewer-local date.
 */
export function formatRelativeTime(
  isoString: string,
  t: TFn,
  locale: string,
  now: Date = new Date()
): string {
  const date = new Date(isoString);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return t('time.justNow');
  if (diffMins < 60) return t('time.minutesAgo', { count: diffMins });
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  if (diffDays < 7) return t('time.daysAgo', { count: diffDays });
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function formatDateOnlyKey(
  dateKey: string,
  locale: string,
  options: Intl.DateTimeFormatOptions
): string {
  // Date-only string convention (project-wide): parse at UTC noon and format
  // with timeZone: 'UTC' so the rendered day never shifts across timezones.
  return new Date(`${dateKey}T12:00:00Z`).toLocaleDateString(locale, {
    ...options,
    timeZone: 'UTC',
  });
}

/**
 * Day-header label for a viewer-local YYYY-MM-DD key:
 * "Today" / "Yesterday" / "Thu, Jan 15" (year appended when not current).
 */
export function formatDayLabel(
  dateKey: string,
  t: TFn,
  locale: string,
  timezone: string = getDeviceTimezone(),
  now: Date = new Date()
): string {
  const todayKey = getDateInTimezone(timezone, now);
  if (dateKey === todayKey) return t('today');

  const yesterdayKey = getDateInTimezone(timezone, new Date(now.getTime() - DAY_MS));
  if (dateKey === yesterdayKey) return t('yesterday');

  const sameYear = dateKey.slice(0, 4) === todayKey.slice(0, 4);
  return formatDateOnlyKey(dateKey, locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: sameYear ? undefined : 'numeric',
  });
}

/**
 * Short label for a YYYY-MM-DD date (the "Scheduled for {date}" late note):
 * "Today" / "Yesterday" / "Jan 15".
 */
export function formatDateShort(
  dateKey: string,
  t: TFn,
  locale: string,
  timezone: string = getDeviceTimezone(),
  now: Date = new Date()
): string {
  const todayKey = getDateInTimezone(timezone, now);
  if (dateKey === todayKey) return t('today');

  const yesterdayKey = getDateInTimezone(timezone, new Date(now.getTime() - DAY_MS));
  if (dateKey === yesterdayKey) return t('yesterday');

  return formatDateOnlyKey(dateKey, locale, { month: 'short', day: 'numeric' });
}
