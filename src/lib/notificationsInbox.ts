// Notifications inbox: flag, types and pure helpers (contract: client flag
// `notifications_inbox`, 3-day window, row copy, push-tap destinations).
//
// Everything here is pure and dependency-light so the page, the bell and the
// tests share one definition.

import { formatTimeOfDay, type TimeLanguage } from '@/utils/timezone';
import type { HourCycle } from '@/utils/hourCycle';
import type { InboxSource } from '@/lib/analytics';

// ── Flag ──────────────────────────────────────────────────────────────────

/**
 * `VITE_NOTIFICATIONS_INBOX` ('on' | 'off'). Unset => ON in non-production
 * builds, OFF in production. Off means: no bell, no route content, no request.
 * Read at call time (not module load) so tests can stub the env per case.
 */
export function inboxFlagValue(value: string | undefined, isProd: boolean): boolean {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return !isProd;
}

export function isInboxEnabled(): boolean {
  return inboxFlagValue(
    import.meta.env.VITE_NOTIFICATIONS_INBOX as string | undefined,
    Boolean(import.meta.env.PROD)
  );
}

// ── Wire types ────────────────────────────────────────────────────────────

export type DoseStatus = 'due' | 'late' | 'not_marked' | 'taken' | 'skipped';

export interface DoseState {
  status: DoseStatus;
  medication_name: string;
  /** 'HH:MM:SS' */
  scheduled_time: string;
  scheduled_date: string;
  actor_first_name?: string | null;
}

export type TargetStatus = 'ok' | 'removed' | 'ended' | 'no_access';

export interface InboxItem {
  id: string;
  type: string;
  circle_id: string | null;
  circle_name: string | null;
  title: string;
  body: string;
  data: Record<string, string | number | boolean>;
  state: DoseState | null;
  read_at: string | null;
  created_at: string;
  updated_at: string;
  target_status: TargetStatus;
}

// ── Analytics enums ───────────────────────────────────────────────────────

/** Every push `data.type` (mobile utils/pushTypes.ts). Anything else reports as 'other'. */
const PUSH_TYPES: readonly string[] = [
  'medication_reminder',
  'medication_late',
  'medication_missed',
  'medication_confirmation',
  'refill_reminder',
  'refill_urgent',
  'task_completed',
  'appointment_completed',
  'task_reminder',
  'appointment_created',
  'task_assigned',
  'note_added',
  'note_nudge',
  'care_note_added',
  'as_needed_dose_given',
  'as_needed_dose_removed',
  'shift',
  'shifts_reopened',
  'daily_update',
  'onboarding_nudge',
  'invite_nudge',
  'invite_expiry_nudge',
  'invite_undelivered',
  'member_joined',
  'member_role_changed',
  'member_removed_by_manager',
  'member_removed',
  'circle_archived',
  'tier_downgrade_view_only',
  'recognition',
  'test',
];

export function inboxTypeEnum(type: unknown): string {
  return typeof type === 'string' && PUSH_TYPES.includes(type) ? type : 'other';
}

export type UnreadBucket = '0' | '1_3' | '4_9' | '10_plus';

export function unreadBucket(count: number): UnreadBucket {
  if (count <= 0) return '0';
  if (count <= 3) return '1_3';
  if (count <= 9) return '4_9';
  return '10_plus';
}

// ── 3-day window (viewer-local days) ──────────────────────────────────────

export type InboxSectionKey = 'today' | 'yesterday' | 'twoDaysAgo';
export const SECTION_ORDER: readonly InboxSectionKey[] = ['today', 'yesterday', 'twoDaysAgo'];

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole local calendar days between `then` and `now` (DST-safe via rounding). */
export function localDayDiff(then: Date, now: Date): number {
  return Math.round((localMidnight(now) - localMidnight(then)) / 86_400_000);
}

export function sectionFor(item: InboxItem, now: Date): InboxSectionKey | null {
  const at = new Date(item.updated_at);
  if (Number.isNaN(at.getTime())) return null;
  const diff = localDayDiff(at, now);
  if (diff <= 0) return 'today'; // a skewed clock never hides a row
  if (diff === 1) return 'yesterday';
  if (diff === 2) return 'twoDaysAgo';
  return null; // older than "2 days ago": dropped
}

export interface InboxSection {
  key: InboxSectionKey;
  items: InboxItem[];
}

/** Newest first within each section; empty sections omitted; older rows dropped. */
export function groupInbox(items: readonly InboxItem[], now: Date): InboxSection[] {
  const buckets: Record<InboxSectionKey, InboxItem[]> = {
    today: [],
    yesterday: [],
    twoDaysAgo: [],
  };
  for (const item of items) {
    const key = sectionFor(item, now);
    if (key) buckets[key].push(item);
  }
  return SECTION_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    items: buckets[key].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    ),
  }));
}

// ── Row copy ──────────────────────────────────────────────────────────────

type TFn = (key: string, options?: Record<string, unknown>) => string;

/** 'HH:MM[:SS]' -> [h, m], or null. */
function parseClock(value: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return [h, min];
}

/** The viewer-local clock of an instant, in the viewer's 12h/24h style. */
export function formatInstantLocal(iso: string, cycle: HourCycle, language?: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  return formatTimeOfDay(at.getHours(), at.getMinutes(), cycle, language as TimeLanguage | undefined);
}

export interface RowCopy {
  title: string;
  /** Secondary line; '' when none. */
  body: string;
}

/**
 * Dose rows (state != null) render from `state`, never from the stored
 * title/body. Other rows show the stored title and body as written.
 */
export function rowCopy(item: InboxItem, t: TFn, cycle: HourCycle, language?: string): RowCopy {
  const state = item.state;
  if (!state) return { title: item.title, body: item.body };

  const clock = parseClock(state.scheduled_time);
  const med = state.medication_name;
  if (!clock || !med) return { title: item.title, body: item.body };
  const time = formatTimeOfDay(clock[0], clock[1], cycle, language as TimeLanguage | undefined);
  const name = state.actor_first_name?.trim();

  switch (state.status) {
    case 'taken': {
      return {
        title: name ? t('inbox.dose.takenBy', { med, time, name }) : t('inbox.dose.taken', { med, time }),
        body: t('inbox.dose.markedAt', { markedTime: formatInstantLocal(item.updated_at, cycle, language) }),
      };
    }
    case 'skipped': {
      return {
        title: name
          ? t('inbox.dose.skippedBy', { med, time, name })
          : t('inbox.dose.skipped', { med, time }),
        body: t('inbox.dose.markedAt', { markedTime: formatInstantLocal(item.updated_at, cycle, language) }),
      };
    }
    case 'due':
      return { title: t('inbox.dose.due', { med, time }), body: item.body };
    case 'late':
    case 'not_marked':
    default:
      return { title: t('inbox.dose.notMarked', { med, time }), body: item.body };
  }
}

/** "{{circle}} · {{time}}": circle only with 2+ circles; time = clock today, else weekday short. */
export function rowMeta(
  item: InboxItem,
  opts: {
    now: Date;
    cycle: HourCycle;
    language: string;
    showCircle: boolean;
    t: TFn;
  }
): string {
  const at = new Date(item.updated_at);
  if (Number.isNaN(at.getTime())) return '';
  const sameDay = localDayDiff(at, opts.now) <= 0;
  let time: string;
  if (sameDay) {
    time = formatInstantLocal(item.updated_at, opts.cycle, opts.language);
  } else {
    try {
      time = new Intl.DateTimeFormat(opts.language, { weekday: 'short' }).format(at);
    } catch {
      time = '';
    }
  }
  if (opts.showCircle && item.circle_name) {
    return opts.t('inbox.meta', { circle: item.circle_name, time });
  }
  return time;
}

// ── Destinations (the same place a push tap goes, on web) ─────────────────

export type GoneReason = 'removed' | 'ended' | 'no_access';

export type InboxDestination =
  | { kind: 'route'; to: string }
  | { kind: 'gone'; reason: GoneReason }
  | { kind: 'none' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

function isRealDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const EVENT_TYPES: ReadonlySet<string> = new Set([
  'medication_reminder',
  'medication_late',
  'medication_missed',
  'medication_confirmation',
  'task_completed',
  'appointment_completed',
  'task_reminder',
  'appointment_created',
  'task_assigned',
  'note_added',
  'note_nudge',
]);
const MEDS_TYPES: ReadonlySet<string> = new Set([
  'refill_reminder',
  'refill_urgent',
  'as_needed_dose_given',
  'as_needed_dose_removed',
]);
const CIRCLE_LOSS_TYPES: ReadonlySet<string> = new Set(['member_removed', 'circle_archived']);

export function resolveInboxDestination(item: InboxItem): InboxDestination {
  // A gone target stays a row and opens the removed state.
  if (item.target_status !== 'ok') return { kind: 'gone', reason: item.target_status };
  if (CIRCLE_LOSS_TYPES.has(item.type)) return { kind: 'gone', reason: 'no_access' };
  if (item.type === 'test') return { kind: 'none' };

  const data = item.data ?? {};
  const circleId = isUuid(item.circle_id) ? item.circle_id : isUuid(data.circleId) ? data.circleId : null;
  if (!circleId) return { kind: 'none' };
  const base = `/circles/${circleId}`;

  const eventId = isUuid(data.eventId) ? data.eventId : null;
  const scheduledDate = isRealDate(data.scheduledDate)
    ? data.scheduledDate
    : isRealDate(item.state?.scheduled_date)
      ? item.state.scheduled_date
      : null;

  if (EVENT_TYPES.has(item.type)) {
    const params = new URLSearchParams();
    if (scheduledDate) params.set('date', scheduledDate);
    if (eventId) params.set('eventId', eventId);
    const qs = params.toString();
    return { kind: 'route', to: `${base}/calendar${qs ? `?${qs}` : ''}` };
  }

  if (MEDS_TYPES.has(item.type)) {
    // Refill pushes before 1.3.1 carried only the series id as `eventId`.
    const medicationId = isUuid(data.medicationId)
      ? data.medicationId
      : item.type.startsWith('refill_')
        ? eventId
        : null;
    return { kind: 'route', to: `${base}/meds${medicationId ? `?medication=${medicationId}` : ''}` };
  }

  switch (item.type) {
    case 'care_note_added':
      return {
        kind: 'route',
        to: `${base}/notes${isRealDate(data.noteDate) ? `?date=${data.noteDate}` : ''}`,
      };
    case 'shift':
    case 'shifts_reopened':
      // The web has a Shifts view of the calendar but no single-shift page.
      return { kind: 'route', to: `${base}/calendar?mode=shifts` };
    case 'daily_update':
      return {
        kind: 'route',
        to: isRealDate(data.date) ? `${base}/daily-update/${data.date}` : base,
      };
    case 'member_joined':
    case 'invite_nudge':
      return { kind: 'route', to: `${base}/members` };
    default:
      // onboarding_nudge, invite_expiry_nudge, invite_undelivered, member_role_changed,
      // member_removed_by_manager, tier_downgrade_view_only, recognition and any
      // unknown future type: the circle's Today.
      return { kind: 'route', to: base };
  }
}

// ── Scoped inbox (one circle) ─────────────────────────────────────────────

/** One circle's inbox. `/notifications` stays the all-circles inbox. */
export function circleInboxPath(circleId: string): string {
  return `/circles/${circleId}/notifications`;
}

const INBOX_SOURCES: readonly InboxSource[] = ['circle_list', 'today_bell', 'header_bell', 'other'];

/** Router location state the inbox entry points pass, for inbox_viewed `source`. */
export interface InboxLocationState {
  inboxSource?: InboxSource;
}

/** The `source` for inbox_viewed: whatever an entry point put in location state, else 'other'. */
export function inboxSourceFromState(state: unknown): InboxSource {
  const value = (state as InboxLocationState | null | undefined)?.inboxSource;
  return value && INBOX_SOURCES.includes(value) ? value : 'other';
}
