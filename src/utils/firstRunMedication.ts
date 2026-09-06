import type { CreateEventRequest } from '@/api/calendarEvents';
import { eventDatesForApi } from '@/utils/recipientEventDate';
import { getDateInTimezone, isEventPastDue } from '@/utils/timezone';

/**
 * The first-run wizard's payload contract.
 *
 * PORT of `mobile/src/utils/firstRunMedicationPayload.ts` (+ the three helpers
 * it composes: `medSchedulePresets.ts`, `recurrenceFormat.ts`'s
 * `recurrenceForSave`, and `siblingDosePayload.ts`). MOBILE IS CANONICAL — read
 * those files before changing anything here.
 *
 * WHY THIS IS A PURE MODULE AND NOT PART OF THE MODAL. The whole point of the
 * wizard is that it writes THE SAME medication row the full form would write
 * for the same answers, on both platforms. Kept pure, that is a unit assertion
 * (`__tests__/firstRunMedication.test.ts`) instead of a rendered-screen
 * comparison — and the one case that actually matters, a sibling dose whose
 * RECIPIENT-frame day differs from the primary's, is unreachable from a
 * rendered test whose viewer/recipient pairing sits a couple of hours apart.
 *
 * ── WEB ADAPTATION ────────────────────────────────────────────────────────
 *
 * Mobile's pickers produce `Date` objects, so its helpers take and return
 * Dates. The web form holds STRINGS (`<input type="time">` → `HH:MM`,
 * `<input type="date">` → `YYYY-MM-DD`) in the VIEWER's frame, and
 * `utils/recipientEventDate` is string-in/string-out to match. So every time
 * here is an `HH:MM` string and `todayStr` is a viewer-frame `YYYY-MM-DD`.
 *
 * The COMPUTATION is unchanged, and that is what parity rests on: mobile
 * combines `today` with a `setHours`-built primary time into a device-local
 * instant and re-expresses it in the recipient's zone; `eventDatesForApi` here
 * builds `new Date(y, m-1, d, hh, mm)` from the same two halves and does the
 * same. For one viewer wall clock and one recipient zone, both platforms
 * serialise the same `scheduled_date` / `scheduled_time`.
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
 *
 * DELIBERATELY NOT `lib/quickPicks.ts`'s `MED_SCHEDULE_PRESETS`. That constant
 * is the AddEventModal chip strip's, and its docstring states the reason it
 * carries only the two single-time presets: the full form has exactly one time
 * field, so twiceDaily/threeTimesDaily are "deliberately omitted rather than
 * approximated" there. The wizard CAN represent them, because it creates one
 * sibling row per extra dose (see `buildSiblingDoseRequests`). Widening the
 * form's constant to serve the wizard would silently add two chips to the form
 * that it cannot honour.
 */
export const FIRST_RUN_SCHEDULE_PRESETS: readonly FirstRunSchedulePreset[] = [
  { key: 'everyMorning', times: ['08:00'] },
  { key: 'everyEvening', times: ['20:00'] },
  { key: 'twiceDaily', times: ['08:00', '20:00'] },
  { key: 'threeTimesDaily', times: ['08:00', '14:00', '20:00'] },
] as const;

/** The default the wizard opens on — 08:00, which is why rule 7 exists. */
export const FIRST_RUN_DEFAULT_PRESET: FirstRunPresetKey = 'everyMorning';

/** The viewer's own calendar day, `YYYY-MM-DD` — the frame the form's inputs are in. */
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
 * The recurrence half of a CREATE payload.
 *
 * BOTH KEYS ARE OMITTED, NEVER NULL, for "no repeat" — and that is not an
 * oversight. Mobile routes this through `recurrenceForSave(rule, null,
 * { clearing: false })`, which returns `{ recurrence_rule: undefined }` rather
 * than null because absent and null are DIFFERENT INSTRUCTIONS to the backend's
 * `eventSchema.partial()`: absent means "leave unchanged", null means "remove
 * it". Only an explicit clearing intent — which a create never has — may send
 * null.
 *
 * `AddEventModal`'s create path already does exactly this, with a bare
 * `let recurrence_rule: string | undefined` that stays undefined for 'none'.
 * This function IS that rule, extracted so the wizard cannot hand-build it
 * differently and so it is assertable without rendering a form. `cycle` is
 * absent on purpose: the wizard offers a deliberate subset of rules (see
 * `requiresFullForm`), and widening it widens what the wizard claims to handle.
 */
export function recurrenceForCreate(recurrence: FirstRunRecurrence): {
  recurrence_rule?: string;
  recurrence_end_date?: string;
} {
  if (recurrence === 'none') {
    return { recurrence_rule: undefined, recurrence_end_date: undefined };
  }
  return { recurrence_rule: recurrence, recurrence_end_date: undefined };
}

export interface FirstRunMedicationInput {
  name: string;
  dosage: string;
  presetKey: FirstRunPresetKey;
  /** Required when `presetKey === 'custom'`; ignored otherwise. `HH:MM`, viewer frame. */
  customTime: string | null;
  recurrence: FirstRunRecurrence;
  /**
   * The RxNorm concept id of a drug PICKED from suggestions.
   *
   * Always absent on web today: this repo ships no drug autocomplete on any
   * medication surface, so every name is typed by hand. The parameter exists so
   * the contract matches mobile's exactly — where a picked drug writes
   * `data.rxcui` and a hand-edit clears it — and so a future web autocomplete
   * plugs in without changing the payload shape. Omitted, never null, when
   * absent: the same shape mobile sends from inside its `if (rxcui)`.
   */
  rxcui?: string;
  /** The CARE RECIPIENT's IANA zone — see the precedence note in the modal. */
  timezone: string;
  /** The viewer's calendar day, `YYYY-MM-DD`. */
  todayStr: string;
}

export interface FirstRunMedicationPayload {
  primary: CreateEventRequest;
  /** `HH:MM` viewer-frame times for the extra doses; one sibling row per entry. */
  additionalTimes: string[];
}

/**
 * Wizard state -> the exact payload AddEventModal would produce for the same
 * answers.
 */
export function buildFirstRunMedication(input: FirstRunMedicationInput): FirstRunMedicationPayload {
  const { name, dosage, presetKey, customTime, recurrence, rxcui, timezone, todayStr } = input;

  const { primaryTime, additionalTimes } = firstRunPresetTimes(presetKey, customTime);

  const { scheduledDate, scheduledTime } = eventDatesForApi({
    dateStr: todayStr,
    timeStr: primaryTime,
    recurrenceEndDateStr: null,
    timezone,
  });

  const trimmedName = name.trim();
  const trimmedDosage = dosage.trim();

  const primary: CreateEventRequest = {
    event_type: 'medication',
    // REQUIRED, by `CreateEventRequest` and by the backend's
    // `z.string().min(1)`. Mirrors `trimmedTitle` in AddEventModal's submit
    // path, which assigns the same value to `title` and `medication_name`.
    title: trimmedName,
    medication_name: trimmedName,
    ...(trimmedDosage ? { medication_dosage: trimmedDosage } : {}),
    ...(rxcui ? { rxcui } : {}),
    scheduled_date: scheduledDate,
    scheduled_time: scheduledTime,
    // EXPLICIT, NEVER OMITTED. `reminder_15m`'s column default is TRUE, so a
    // payload that left these out would come back with an extra 15-minutes-early
    // push that an identical form-created medication does not have — a silent
    // divergence between the two paths, on the flag the DB is opinionated about.
    // The form reaches the same state through its own defaults — 15m starts OFF
    // for a medication, whose at-dose push and escalation chain already cover it
    // — not through `reminderFlagsForSave`, which now saves the selection
    // verbatim and rewrites nothing.
    reminder_24h: false,
    reminder_1h: false,
    reminder_30m: false,
    reminder_15m: false,
    // TRUE while the four above are false, and explicit for the same reason
    // they are: this path states every reminder flag rather than inheriting a
    // column default. `reminder_at_due` is the alert AT the dose time — the
    // entire point of the wizard's medication — so "not asked" means ON here,
    // matching both the column default and what the form produces for a fresh
    // medication. The four EARLIER reminders stay off because the wizard never
    // offered them.
    reminder_at_due: true,
    // EXPLICIT, same class of trap: `notifications_enabled` is `BOOLEAN NOT NULL
    // DEFAULT TRUE` and happens to agree with the wizard's intent today. This
    // module's job is to match the form's payload, not to coincide with a
    // default that can change independently.
    notifications_enabled: true,
    // `track_refills` is DELIBERATELY ABSENT — the one field leaning on a column
    // default. The wizard asks nothing about refills and the default (false) is
    // what "not asked" means; sending `false` would claim the user answered a
    // question they were never shown. Called out rather than fixed, exactly as
    // mobile does.
    ...recurrenceForCreate(recurrence),
  };

  return { primary, additionalTimes };
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
 * WIRE PARITY WITH MOBILE: mobile also clears `pills_per_dose`, a field this
 * repo's `CreateEventRequest` does not model at all. `undefined` and an absent
 * key serialise identically through `JSON.stringify`, so the request bodies are
 * byte-identical either way.
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
    alert_days_before: undefined,
    scheduled_time: overrides.scheduledTime,
    scheduled_date: overrides.scheduledDate,
    recurrence_end_date: overrides.recurrenceEndDate,
    ...(overrides.refillGroupId ? { refill_group_id: overrides.refillGroupId } : {}),
  };
}

/**
 * One `CreateEventRequest` per ADDITIONAL dose time, each carrying its OWN
 * clock and its OWN date rather than the primary's.
 *
 * The case this exists for is a dose whose recipient-frame DAY differs from the
 * primary's — an evening dose that has already rolled past midnight in the
 * recipient's zone. Borrowing the primary's `scheduled_date` there stores the
 * dose a full calendar day out and the reminder fires 24 hours late.
 */
export function buildSiblingDoseRequests(input: {
  primary: CreateEventRequest;
  additionalTimes: string[];
  timezone: string;
  todayStr: string;
  /** Absent when the primary create returned no id — see `siblingDosePayload`. */
  refillGroupId?: string;
}): CreateEventRequest[] {
  const { primary, additionalTimes, timezone, todayStr, refillGroupId } = input;

  return additionalTimes.map((extraTime) => {
    // BOTH re-expressed at THAT dose's time — never borrowed from the primary.
    const { scheduledDate, scheduledTime } = eventDatesForApi({
      dateStr: todayStr,
      timeStr: extraTime,
      recurrenceEndDateStr: null,
      timezone,
    });
    return siblingDosePayload(primary, {
      scheduledTime: scheduledTime as string,
      scheduledDate,
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
