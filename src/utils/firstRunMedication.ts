import type { CreateEventRequest } from '@/api/calendarEvents';
import { extraDoseForApi } from '@/utils/recipientEventDate';
import type { HourCycle } from '@/utils/hourCycle';
import { formatTimeOfDay, getDateInTimezone, isEventPastDue } from '@/utils/timezone';

/**
 * First-run schedule helpers: preset times and sibling-dose rows.
 *
 * The first-run wizard saves through the real simple medication form
 * (AddEventModal firstRun); this module keeps only the helpers that path still
 * uses (`siblingDosePayload`, ...). There is deliberately NO standalone payload
 * builder: custom times use the CIRCLE's clock, and an earlier builder here
 * treated them as the viewer's, so it was removed rather than left as a template.
 *
 * Every time here is an `HH:MM` string. A schedule PRESET names the circle's
 * clock and is sent verbatim on the circle's day. All rows of one medication
 * start on the SAME circle day (BC-1): the primary's.
 */

export type FirstRunPresetKey =
  'everyMorning' | 'everyEvening' | 'twiceDaily' | 'threeTimesDaily' | 'custom';

export type FirstRunRecurrence = 'daily' | 'every_other_day' | 'weekly' | 'none';

/** The four presets, left to right. `custom` is not one — it opens a picker. */
export const FIRST_RUN_PRESET_ORDER: Exclude<FirstRunPresetKey, 'custom'>[] = [
  'everyMorning',
  'everyEvening',
  'twiceDaily',
  'threeTimesDaily',
];

/** Repeat chips, left to right. */
export const FIRST_RUN_REPEAT_ORDER: FirstRunRecurrence[] = [
  'daily',
  'every_other_day',
  'weekly',
  'none',
];

export interface FirstRunSchedulePreset {
  key: Exclude<FirstRunPresetKey, 'custom'>;
  /** First entry is the primary time; the rest become additional dose times. */
  times: string[];
}

/**
 * VERBATIM from `mobile/src/utils/medSchedulePresets.ts` — same keys, same
 * order, same clock times, only expressed as `HH:MM` strings.
 */
export const FIRST_RUN_SCHEDULE_PRESETS: readonly FirstRunSchedulePreset[] = [
  { key: 'everyMorning', times: ['08:00'] },
  { key: 'everyEvening', times: ['20:00'] },
  { key: 'twiceDaily', times: ['08:00', '20:00'] },
  { key: 'threeTimesDaily', times: ['08:00', '14:00', '20:00'] },
] as const;

/** The default the wizard opens on — 08:00, which is why rule 7 exists. */
export const FIRST_RUN_DEFAULT_PRESET: FirstRunPresetKey = 'everyMorning';

/** The viewer's own calendar day, `YYYY-MM-DD` — the frame a CUSTOM time is typed in. */
export function viewerToday(now: Date = new Date()): string {
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * The dose times a schedule answer means: the primary, plus one entry per
 * ADDITIONAL dose.
 *
 * Mirrors `applyMedSchedulePreset`, minus its `recurrenceRule: 'daily'` — that
 * field is always the literal 'daily' and the rule actually comes from step ④.
 * Returning it here is the one place the two could silently disagree, so it is
 * not returned at all.
 */
export function firstRunPresetTimes(
  presetKey: FirstRunPresetKey,
  customTime: string | null
): { primaryTime: string; additionalTimes: string[] } {
  if (presetKey === 'custom') {
    if (!customTime) throw new Error('custom preset requires a customTime');
    return { primaryTime: customTime, additionalTimes: [] };
  }
  const preset = FIRST_RUN_SCHEDULE_PRESETS.find((p) => p.key === presetKey);
  if (!preset) throw new Error(`unknown preset: ${presetKey}`);
  const [first, ...rest] = preset.times;
  return { primaryTime: first, additionalTimes: rest };
}

/**
 * Every dose time a schedule answer means, in order (`HH:MM`, the viewer frame
 * the wizard's own step ③ shows). Safe for the display-only previews: a custom
 * preset with no time yet yields an empty list rather than throwing.
 */
export function firstRunAllTimes(
  presetKey: FirstRunPresetKey,
  customTime: string | null
): string[] {
  if (presetKey === 'custom' && !customTime) return [];
  const { primaryTime, additionalTimes } = firstRunPresetTimes(presetKey, customTime);
  return [primaryTime, ...additionalTimes];
}

/**
 * `HH:MM` -> display text through the app's canonical `formatTimeOfDay`, so the
 * viewer's 12h/24h cycle (and the language's period marker) apply.
 */
export function formatFirstRunTime(time: string, cycle: HourCycle): string {
  const [h, m] = time.split(':').map((n) => Number.parseInt(n, 10));
  return formatTimeOfDay(h || 0, m || 0, cycle);
}

/**
 * The payload for an ADDITIONAL dose row (the 20:00 half of a BID medication).
 *
 * PORT of `mobile/src/utils/siblingDosePayload.ts`. Each dose time is its own
 * calendar event, but the BOTTLE is not: a twice-daily medication is one
 * physical container. Spreading the primary wholesale made a 60-tablet bottle
 * into TWO independent 60-tablet counters, each draining at half the real rate,
 * so both rows reported ~30 days of supply on the day the bottle actually ran
 * out and the refill alert — the whole feature — fired late.
 *
 * So the sibling POINTS AT THE PRIMARY: `refill_group_id` names the row that
 * owns the bottle, and the backend's `apply_refill_decrement` resolves
 * `COALESCE(refill_group_id, id)` before it locks or subtracts anything, so
 * every dose time decrements the SAME counter.
 *
 * THE SIBLING CARRIES NO REFILL STATE OF ITS OWN, and that is the point: a
 * second `quantity_remaining` here is a second counter that can only disagree
 * with the first. `track_refills` stays false for the same reason — the route
 * reads the OWNER's flag.
 *
 * WIRE PARITY WITH MOBILE: `pills_per_dose` is cleared too (mobile's helper does
 * the same); `undefined` serialises as an absent key.
 */
export function siblingDosePayload(
  primary: CreateEventRequest,
  overrides: {
    scheduledTime: string;
    scheduledDate: string;
    recurrenceEndDate?: string;
    /**
     * The primary row's id — known only AFTER it is created, which is why this
     * is an override rather than something read off `primary`. Omitted when the
     * create returned no id: the key is then ABSENT rather than null, because
     * the backend reads an absent key as "leave alone" while an explicit null
     * would detach a row that never had a bottle.
     */
    refillGroupId?: string;
  }
): CreateEventRequest {
  return {
    ...primary,
    track_refills: false,
    quantity_in_bottle: undefined,
    quantity_remaining: undefined,
    pills_per_day: undefined,
    pills_per_dose: undefined,
    alert_days_before: undefined,
    scheduled_time: overrides.scheduledTime,
    scheduled_date: overrides.scheduledDate,
    recurrence_end_date: overrides.recurrenceEndDate,
    ...(overrides.refillGroupId ? { refill_group_id: overrides.refillGroupId } : {}),
  };
}

/**
 * One `CreateEventRequest` per ADDITIONAL dose time. Every row of one medication starts on the SAME circle-zone day,
 * the primary's (BC-1): the extra dose differs only in its clock.
 *
 * `additionalTimes` are the CIRCLE's clock `HH:MM` for a preset (sent verbatim, on the primary's day). Pass `viewer`
 * when they are hand-picked VIEWER wall clocks instead: each is then re-expressed in the circle's zone with
 * `extraDoseForApi`, which finds the viewer day whose instant falls on the primary's circle day (placing it on the
 * primary's VIEWER day moved a dose whose real instant is on another viewer day a whole circle day early).
 */
export function buildSiblingDoseRequests(input: {
  primary: CreateEventRequest;
  additionalTimes: string[];
  timezone: string;
  /** Set when `additionalTimes` are viewer-frame clocks: the viewer's day and the primary's viewer clock. */
  viewer?: { todayStr: string; primaryTime: string };
  /** Absent when the primary create returned no id — see `siblingDosePayload`. */
  refillGroupId?: string;
}): CreateEventRequest[] {
  const { primary, additionalTimes, timezone, viewer, refillGroupId } = input;

  return additionalTimes.map((extraTime) => {
    const { scheduledDate, scheduledTime } = viewer
      ? extraDoseForApi({
          dateStr: viewer.todayStr,
          timeStr: viewer.primaryTime,
          extraTimeStr: extraTime,
          timezone,
        })
      : { scheduledDate: primary.scheduled_date, scheduledTime: extraTime };
    return siblingDosePayload(primary, {
      scheduledTime,
      scheduledDate,
      recurrenceEndDate: primary.recurrence_end_date ?? undefined,
      refillGroupId,
    });
  });
}

/**
 * Is this dose already in the past for TODAY in the recipient's zone — so no
 * reminder can fire for it?
 *
 * THE DEFAULT PRESET IS 08:00 AND CIRCLES GET CREATED IN THE EVENING, which
 * makes this the likely path rather than an edge case: someone setting up a
 * circle after dinner and accepting the default would otherwise silently save a
 * dose that can never notify them.
 *
 * The same predicate AddEventModal's submit path spells inline
 * (`scheduled_date === getDateInTimezone(timezone) && isEventPastDue(...)`),
 * extracted so the decision is a fixed-instant unit assertion instead of
 * something only reproducible by running the suite at the right hour.
 *
 * Only TODAY qualifies. A dose whose recipient-frame date has already rolled to
 * tomorrow is not past due — it is simply scheduled, and warning would be wrong.
 */
export function isFirstRunDosePastDue(
  primary: CreateEventRequest,
  timezone: string,
  now: Date = new Date()
): boolean {
  const scheduledTime = primary.scheduled_time;
  const scheduledDate = primary.scheduled_date;
  if (!scheduledTime || !scheduledDate) return false;
  if (scheduledDate !== getDateInTimezone(timezone, now)) return false;
  return isEventPastDue(scheduledDate, scheduledTime, timezone, now);
}

/**
 * Constraint 4. A multi-dose preset on a NON-DAILY rule means sibling doses on
 * a rule the sibling/timezone helpers are least exercised on, so the wizard
 * hands those to the full form instead of guessing.
 *
 * Single-time presets combine with every repeat option freely.
 */
export function requiresFullForm(
  presetKey: FirstRunPresetKey,
  recurrence: FirstRunRecurrence
): boolean {
  const MULTI_DOSE: FirstRunPresetKey[] = ['twiceDaily', 'threeTimesDaily'];
  return MULTI_DOSE.includes(presetKey) && recurrence !== 'daily';
}
