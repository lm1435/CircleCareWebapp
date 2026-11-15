import type { CreateEventRequest } from '@/api/calendarEvents';

/**
 * First-run medication helpers.
 *
 * The first-run wizard saves through the real simple medication form
 * (AddEventModal firstRun); this module keeps only what that path still uses:
 * `siblingDosePayload`, plus the first-run preset/recurrence types. There is
 * deliberately NO standalone payload builder: custom times use the CIRCLE's
 * clock, and an earlier builder here treated them as the viewer's, so it was
 * removed rather than left as a template.
 *
 * All rows of one medication start on the SAME circle day (BC-1): the primary's.
 */

export type FirstRunPresetKey =
  'everyMorning' | 'everyEvening' | 'twiceDaily' | 'threeTimesDaily' | 'custom';

export type FirstRunRecurrence = 'daily' | 'every_other_day' | 'weekly' | 'none';

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
