import type { CalendarEvent } from '@/api/calendarEvents';
import type { CareNote } from '@/api/careNotes';
import type { HealthVital, LatestVitals, VitalType } from '@/api/vitals';
import type { ActivityFeedItem } from '@/api/activityFeed';

// LIVE PAGE SUMMARIES (owner 2026-11-07, option C). A page's subtitle is a one-line summary built from
// data the page ALREADY loaded (no new fetches), instead of marketing copy that restates the title:
//   Calendar  "3 doses and 1 appointment today" (per view)
//   Tasks     "4 open · 1 due today"
//   Notes     "Last note today at 2:10 PM by Jordan"
//   Vitals    "Last reading: blood pressure, today 8:05 AM"
//   Documents "12 documents"
//   Activity  "9 updates this week"
// Emergency keeps its instructional line. Every function returns a finished, translated string; while
// a page is still loading it holds `HOLD` so the header keeps its height (no jump). Mirrors the
// shifts/medications summaries (`shiftsPageSummary`, `medicationsSummaryText`).

export type SummaryT = (key: string, opts?: Record<string, unknown>) => string;

/** A non-breaking space: holds the subtitle line's height until the data answers. */
export const HOLD = ' ';

export type CalendarSummaryView = 'day' | 'week' | 'month';

/** "A, B and C" in the UI language (Intl.ListFormat; falls back to ", " where unavailable). */
function joinList(parts: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts);
  } catch {
    return parts.join(', ');
  }
}

/**
 * Calendar: doses, appointments and tasks in the shown day / week / month. Shifts have their own
 * summary and are not counted here.
 */
export function calendarSummary(
  t: SummaryT,
  events: readonly CalendarEvent[],
  opts: {
    view: CalendarSummaryView;
    /** Day view only: the shown day is today in the recipient's zone. */
    isToday: boolean;
    /** Narrows `events` to the day / week / month shown (the month grid loads 42 days). */
    inRange: (date: string) => boolean;
    locale: string;
  }
): string {
  const visible = events.filter((e) => opts.inRange(e.scheduled_date));
  const doses = visible.filter((e) => e.event_type === 'medication').length;
  const appointments = visible.filter((e) => e.event_type === 'appointment').length;
  const tasks = visible.filter((e) => e.event_type === 'task').length;
  const scope =
    opts.view === 'week' ? 'week' : opts.view === 'month' ? 'month' : opts.isToday ? 'today' : 'day';
  const parts = [
    doses > 0 ? t('calendar:daySummary.doses', { count: doses }) : '',
    appointments > 0 ? t('calendar:daySummary.appointments', { count: appointments }) : '',
    tasks > 0 ? t('calendar:daySummary.tasks', { count: tasks }) : '',
  ].filter(Boolean);
  const items = joinList(parts, opts.locale);
  // Literal keys on purpose (the dynamic-key pin in i18n/__tests__/translationKeys stays put).
  switch (scope) {
    case 'today':
      return parts.length === 0 ? t('calendar:summary.none.today') : t('calendar:summary.today', { items });
    case 'week':
      return parts.length === 0 ? t('calendar:summary.none.week') : t('calendar:summary.week', { items });
    case 'month':
      return parts.length === 0 ? t('calendar:summary.none.month') : t('calendar:summary.month', { items });
    default:
      return parts.length === 0 ? t('calendar:summary.none.day') : t('calendar:summary.day', { items });
  }
}

/**
 * Tasks: "4 open · 1 due today" for the open list, "3 completed" on the Completed filter. Counts the
 * rows the page loaded for its current filter.
 */
export function tasksSummary(
  t: SummaryT,
  tasks: readonly CalendarEvent[],
  opts: { status: 'open' | 'completed' | 'all'; today: string | undefined }
): string {
  if (opts.status === 'completed') {
    return tasks.length === 0
      ? t('tasks:summary.noneCompleted')
      : t('tasks:summary.completed', { count: tasks.length });
  }
  const open = tasks.filter((x) => !x.completed_at);
  if (open.length === 0) return t('tasks:summary.none');
  const dueToday = opts.today ? open.filter((x) => x.scheduled_date === opts.today).length : 0;
  const parts = [t('tasks:summary.open', { count: open.length })];
  if (dueToday > 0) parts.push(t('tasks:summary.dueToday', { count: dueToday }));
  return parts.join(' · ');
}

/** "today" | "yesterday" | the date, for a recipient-zone YYYY-MM-DD against today's. */
function dayRelation(date: string, today: string): 'today' | 'yesterday' | 'other' {
  if (date === today) return 'today';
  const y = new Date(`${today}T12:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  return date === y.toISOString().slice(0, 10) ? 'yesterday' : 'other';
}

/**
 * Notes: the newest note, its day, time and author: "Last note today at 2:10 PM by Jordan".
 * `formatTime` renders the note's created_at in the recipient zone and the viewer's clock;
 * `formatDate` renders a YYYY-MM-DD.
 */
export function notesSummary(
  t: SummaryT,
  notes: readonly CareNote[],
  opts: {
    today: string | undefined;
    formatTime: (isoString: string) => string;
    formatDate: (date: string) => string;
  }
): string {
  if (notes.length === 0) return t('notes:summary.none');
  const latest = notes.reduce((a, b) => (Date.parse(b.created_at) > Date.parse(a.created_at) ? b : a));
  const name =
    `${latest.author?.first_name ?? ''} ${latest.author?.last_name ?? ''}`.trim() ||
    t('notes:row.formerMember');
  const time = opts.formatTime(latest.created_at);
  const relation = opts.today ? dayRelation(latest.note_date, opts.today) : 'other';
  if (relation === 'today') return t('notes:summary.lastToday', { time, name });
  if (relation === 'yesterday') return t('notes:summary.lastYesterday', { time, name });
  return t('notes:summary.lastOn', { date: opts.formatDate(latest.note_date), time, name });
}

/**
 * Vitals: the newest reading across all types (the per-type "latest" the page already holds):
 * "Last reading: blood pressure, today 8:05 AM".
 */
export function vitalsSummary(
  t: SummaryT,
  latest: LatestVitals | undefined,
  opts: {
    today: string;
    /** Recipient-zone wall date + time of a UTC instant. */
    toWall: (recordedAt: string) => { date: string; time: string };
    formatTime: (time: string) => string;
    formatDate: (date: string) => string;
    locale: string;
  }
): string {
  const readings: HealthVital[] = latest
    ? (Object.values(latest) as (HealthVital | null | undefined)[]).filter(
        (v): v is HealthVital => !!v
      )
    : [];
  if (readings.length === 0) return t('vitals:summary.none');
  const newest = readings.reduce((a, b) =>
    Date.parse(b.recorded_at) > Date.parse(a.recorded_at) ? b : a
  );
  const wall = opts.toWall(newest.recorded_at);
  const typeName = vitalTypeName(t, newest.vital_type);
  // Mid-sentence in the UI language; German nouns keep their capital.
  const type = opts.locale.startsWith('de') ? typeName : typeName.toLocaleLowerCase(opts.locale);
  const time = opts.formatTime(wall.time);
  const relation = dayRelation(wall.date, opts.today);
  if (relation === 'today') return t('vitals:summary.lastToday', { type, time });
  if (relation === 'yesterday') return t('vitals:summary.lastYesterday', { type, time });
  return t('vitals:summary.lastOn', { type, time, date: opts.formatDate(wall.date) });
}

function vitalTypeName(t: SummaryT, type: VitalType): string {
  switch (type) {
    case 'blood_pressure':
      return t('vitals:types.blood_pressure');
    case 'heart_rate':
      return t('vitals:types.heart_rate');
    case 'glucose':
      return t('vitals:types.glucose');
    case 'weight':
      return t('vitals:types.weight');
    case 'temperature':
      return t('vitals:types.temperature');
    default:
      return t('vitals:types.oxygen_saturation');
  }
}

/** Documents: "12 documents" (all categories, not the filtered view). */
export function documentsSummary(t: SummaryT, count: number): string {
  return count === 0 ? t('documents:summary.none') : t('documents:count', { count });
}

/**
 * Activity: updates in the last 7 days among the pages loaded. When more pages exist and the oldest
 * loaded row is still inside the week, the count is a floor, so it reads "9+ updates this week".
 */
export function activitySummary(
  t: SummaryT,
  activities: readonly Pick<ActivityFeedItem, 'created_at'>[],
  opts: { now?: Date; hasMore: boolean }
): string {
  const cutoff = (opts.now ?? new Date()).getTime() - 7 * 24 * 60 * 60 * 1000;
  const inWeek = activities.filter((a) => Date.parse(a.created_at) >= cutoff);
  if (inWeek.length === 0) return t('activity:summary.none');
  const partial = opts.hasMore && inWeek.length === activities.length;
  return t(partial ? 'activity:summary.weekMore' : 'activity:summary.week', { count: inWeek.length });
}
