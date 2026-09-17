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
 * that can never fire. They are still SAVED as chosen: unsendable is inert, not
 * a reason to overwrite the selection (see `reminderFlagsForSave`).
 */
export function remindersApply(eventType: EventType, scheduledTime: string): boolean {
  return eventType === 'medication' || !!scheduledTime.trim();
}

export interface ReminderSelection {
  /**
   * The alert AT the scheduled time — the anchor alert (Apple's model), an
   * opt-OUT rather than an opt-in. The four below are the "earlier reminders".
   */
  reminder_at_due: boolean;
  reminder_24h: boolean;
  reminder_1h: boolean;
  reminder_30m: boolean;
  reminder_15m: boolean;
}

/**
 * Reminder flags to persist: the user's selection, VERBATIM, always.
 *
 * THE SELECTION IS DATA. SILENCE IS `notifications_enabled`'s JOB. This helper
 * used to zero all five flags whenever the master toggle was off or there was
 * no time to fire against. Both premises are now false, and the zeroing was
 * destroying user data.
 *
 *  1. THE MASTER TOGGLE. "Notifications off means nothing is sent" was once
 *     enforced HERE because it was enforced nowhere else:
 *     `process_task_reminders()` read the four `reminder_*` columns and honoured
 *     no mute at all, so blanking them was the only way the switch could mean
 *     anything for a task or appointment. That gap closed — migration
 *     20260823120000 added `notifications_enabled = true` to the four
 *     pre-reminder blocks, and 20260901120000 added the fifth, at-due block
 *     already carrying it. EVERY selector that can send now filters on the
 *     mute: all five blocks of `process_task_reminders()`, all five of
 *     `process_medication_reminders()`, `process_tier1_reminders()`,
 *     `process_tier2_family_alerts()`, `process_tier3_missed()`, and the manual
 *     `POST /task-reminders` sweep.
 *
 *  2. NO TIME TO FIRE AGAINST. Those same selectors all filter
 *     `scheduled_time IS NOT NULL`, so a timeless task's flags are INERT rather
 *     than dangerous. Zeroing them was the worse option: it wrote
 *     `reminder_at_due = false` onto the row, so adding a time later produced a
 *     silent event with nothing on screen to explain it.
 *
 * THE COST WAS PERMANENT. `reminder_at_due` is `BOOLEAN NOT NULL DEFAULT TRUE`,
 * so a zeroed row stores a plain `false` that is INDISTINGUISHABLE from a
 * deliberate opt-out — turning the master back on could not restore it, and no
 * hydration rule can either. Do not add one, and do not backfill.
 *
 * It is also what the UI already promised: `nextReminderControlState` rule 3
 * leaves the four earlier flags ALONE when the master goes off, so that toggling
 * back on restores the previous selection. Only this function disagreed, and
 * only at save time — which is why an off→on cycle looked correct until the
 * modal was closed and reopened.
 *
 * `notificationsEnabled` and `applicable` are retained so the call site keeps
 * stating the conditions this helper deliberately no longer acts on.
 *
 * DEPLOY ORDER — A HARD PREREQUISITE, ENFORCED BY NOBODY. Migrations
 * 20260823120000 and 20260901120000 MUST be applied to the production database
 * BEFORE this webapp ships. Nothing in the client, the API, or the schema
 * detects the wrong order; the only symptom is a reminder firing.
 *
 * An earlier draft of this note claimed the ordering was structurally
 * impossible to get wrong — that "the client cannot reach a backend that lacks
 * the guard", because these migrations also add the `reminder_at_due` column
 * this payload already sends. THAT IS FALSE, and it is false in the direction
 * that hurts:
 *
 *   - `validateBody` runs `req.body = schema.parse(req.body)`, and zod STRIPS
 *     unknown keys. The event schema deployed on `master` has no
 *     `reminder_at_due` member, so the field is dropped in the middleware. The
 *     insert never sees it, PostgREST never reports 42703, and the request
 *     answers 200. The mismatch is silent by construction.
 *   - `process_task_reminders()` as deployed (newest definition on `master` is
 *     20260728120000) contains ZERO occurrences of `notifications_enabled`.
 *     The 15m block gates on `ce.reminder_15m = true` and nothing else.
 *
 * So against a database without 20260823120000: a task saved with the master
 * toggle OFF now stores `notifications_enabled = false` alongside
 * `reminder_15m = true`, and the 15-minute push fires anyway — every day, for
 * every occurrence of a recurring series. The zeroing this function used to do
 * was the ONLY thing suppressing it. `reminder_at_due` is the mirror image:
 * until 20260901120000 lands the column does not exist, so an anchor-only
 * event (the one configuration rule 1's guard exists to protect) is completely
 * silent while the UI reports reminders on.
 *
 * Both migrations are additive. Neither is on `master` today — 20260823120000
 * is on `main` only, and 20260901120000 is not committed at all. Verify with
 * `git merge-base --is-ancestor <sha> origin/master` before shipping the web
 * bundle, not after.
 */
export function reminderFlagsForSave(
  selection: ReminderSelection,
  _notificationsEnabled: boolean,
  _applicable: boolean
): ReminderSelection {
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

// ─── The "15 minutes before" default ─────────────────────────────────────────

/**
 * Whether "15 minutes before" starts checked on a FRESH form of this type.
 *
 * OFF, for EVERY type. "Earlier reminders" is an opt-IN group and nothing in it
 * is pre-selected: a new entry fires once, at the time it is scheduled for, and
 * anything earlier is a choice the user makes.
 *
 * It used to be ON for task / appointment, on the grounds that those types had
 * NO at-time notification, so the four earlier flags were the only notifications
 * they had and an all-off default would ship a silent event. THAT PREMISE DIED
 * WITH MIGRATION 20260901120000: `reminder_at_due` is a real column on every
 * event, `BOOLEAN NOT NULL DEFAULT TRUE`, and `process_task_reminders()` carries
 * an at-due block that reads it — `event_type IN ('task','appointment') AND
 * ce.reminder_at_due = true`. A task with all four earlier boxes off is NOT
 * silent; it is an entry that speaks exactly once, when it is due. The same
 * stale assumption was already corrected on the sync side (the `reminderAtDue`
 * clauses in `nextReminderControlState`) and in the warning copy
 * (`showNoneSelectedWarning`); this is the default catching up to both.
 *
 * The visible cost of the old default was on the EDIT form. A task created with
 * a pre-checked 15m stores `reminder_15m = true`, so reopening it showed a box
 * the user never ticked — and, being real stored data, it kept sending a second
 * push 15 minutes early forever, on every occurrence of a recurring series.
 * (Medication was already OFF for a related reason: `notifications_enabled`
 * alone fires the at-dose-time push AND the escalation chain, so a pre-checked
 * 15m there was a pure duplicate — a 4x/day medication meant 8 pushes a day.)
 *
 * MOBILE PARITY, NOT A WEB PREFERENCE. This is the same rule, with the same
 * name, as `mobile/src/utils/reminderNotices.ts`'s `defaultReminder15mFor`,
 * which returns false for every type. The two clients write to one column read
 * by one cron; a task created on the phone and the same task created here must
 * arrive with the same flags.
 *
 * The type parameter is retained: it is what the call sites (mount, hydration,
 * the type switcher) pass, and a future per-type default belongs here rather
 * than back inline at those sites, which is where they got it wrong before.
 *
 * ALREADY-SAVED EVENTS KEEP THEIR STORED VALUE — see `hydratedReminder15m`.
 */
export function defaultReminder15mFor(_eventType: EventType | undefined | null): boolean {
  return false;
}

/**
 * `reminder_15m` for an existing event being loaded into the form.
 *
 * An explicitly stored value ALWAYS wins — hydration never overrides a choice,
 * including a choice made FOR the user by the old task/appointment default. A
 * task created under it really does hold `reminder_15m = true`, that is what the
 * cron will actually send, and silently rewriting it on open would mutate a
 * notification the user never touched. The fallback covers only a row that came
 * back without the key at all (`null`/`undefined`), and it agrees with the
 * fresh-form default: off.
 *
 * `??` not `||`: an explicit stored `false` must survive.
 *
 * Note the deliberate contrast with `reminder_at_due`, which AddEventModal
 * hydrates `?? true`. That column is `NOT NULL DEFAULT TRUE`, so an absent key
 * there can only mean "not serialised", and defaulting it off would show an
 * unchecked box for an alert the server WILL send. `reminder_15m` is the
 * opposite kind of flag: opt-in, and off is the honest blank.
 */
export function hydratedReminder15m(
  eventType: EventType,
  stored: boolean | null | undefined
): boolean {
  return stored ?? defaultReminder15mFor(eventType);
}
