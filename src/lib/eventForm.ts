// Shared save-payload rules for AddEventModal.
// Mirrors mobile/src/utils/eventAssignment.ts and eventScheduling.ts — the two
// surfaces must agree on what gets persisted for the same user action.

import { type EventType } from '@/api/calendarEvents';

/** Event types that carry an assignee. Medications are handled by the circle. */
export function supportsAssignee(eventType: EventType): boolean {
  return eventType === 'task' || eventType === 'appointment';
}

/**
 * The `assigned_to` value to send, or `undefined` to omit the key entirely.
 *
 * Updates are applied as partial patches server-side (`updates = req.body`), so
 * an omitted key means "leave unchanged". Sending `assigned_to` only when it was
 * truthy therefore made unassigning impossible: choosing "Anyone" cleared the
 * local state and then dropped the field, so the previous assignee survived the
 * save with no visible error. Assignable types always send a value, `null`
 * included; the backend accepts it (`z.string().uuid().nullable().optional()`).
 */
export function assignedToForSave(
  eventType: EventType,
  assignedTo: string | null
): string | null | undefined {
  if (!supportsAssignee(eventType)) return undefined;
  // Anything blank is an unassignment, not an id — an empty string would fail
  // the backend's uuid() check with a 400 rather than clearing the assignee.
  const trimmed = assignedTo?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Whether reminders apply. Medications always have a time (the form requires
 * one); appointments and tasks only once one is set.
 *
 * Every cron reminder function filters `scheduled_time IS NOT NULL`, so without
 * a time these fields are unsendable — offering them promises a notification
 * that can never fire, and `reminder_15m` defaults to true.
 */
export function remindersApply(eventType: EventType, scheduledTime: string): boolean {
  return eventType === 'medication' || !!scheduledTime.trim();
}

export interface ReminderSelection {
  reminder_24h: boolean;
  reminder_1h: boolean;
  reminder_30m: boolean;
  reminder_15m: boolean;
}

const NO_REMINDERS: ReminderSelection = {
  reminder_24h: false,
  reminder_1h: false,
  reminder_30m: false,
  reminder_15m: false,
};

/** Reminder flags to persist — zeroed unless notifications are on AND a time exists. */
export function reminderFlagsForSave(
  selection: ReminderSelection,
  notificationsEnabled: boolean,
  applicable: boolean
): ReminderSelection {
  if (!notificationsEnabled || !applicable) return { ...NO_REMINDERS };
  return { ...selection };
}

/** Duration presets for appointments and tasks, in minutes. */
export const DURATION_PRESETS = [30, 60, 120] as const;
export const DEFAULT_DURATION_MINUTES = DURATION_PRESETS[0];

/**
 * Parse HH:MM into minutes since midnight, or null when malformed.
 *
 * Note `''.split(':')` is `['']` and `Number('')` is 0, not NaN — so the parts
 * count has to be checked before the values, or an empty input silently reads
 * as midnight.
 */
function parseTimeStr(timeStr: string): number | null {
  const parts = timeStr.split(':');
  if (parts.length < 2) return null;
  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

/** Add minutes to an HH:MM string, clamping at end of day. */
export function addMinutesToTimeStr(timeStr: string, minutes: number): string {
  const start = parseTimeStr(timeStr);
  if (start === null) return '';
  // Clamp rather than roll over: the event carries a single scheduled_date, so
  // a next-day end time would describe a span the calendar cannot render.
  const total = Math.min(start + minutes, 23 * 60 + 59);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutes between two HH:MM strings, or null when either is missing/invalid. */
export function minutesBetween(startStr: string, endStr: string): number | null {
  const start = parseTimeStr(startStr);
  const end = parseTimeStr(endStr);
  if (start === null || end === null) return null;
  return end - start;
}

/** Index of the preset matching the span, or -1 for a custom duration. */
export function matchingDurationIndex(startStr: string, endStr: string): number {
  const mins = minutesBetween(startStr, endStr);
  if (mins === null) return -1;
  return DURATION_PRESETS.indexOf(mins as (typeof DURATION_PRESETS)[number]);
}
