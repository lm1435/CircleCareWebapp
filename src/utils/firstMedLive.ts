import { addDays, getDayOfWeek } from '@/components/calendar/dateMath';
import type { FirstMedLiveRoot } from '@/api/calendarEvents';

/**
 * Today's first-med card, resolved against the LIVE medication (prod 1.4.1, 2026-11-14).
 * Twin of mobile/src/utils/firstMedLive.ts: same rules, same order.
 *
 * The local first-med note (lib/firstMedNote) is written ONCE, when the first medication is
 * saved, and only says WHICH event to look at and whether Mark it already succeeded. It used
 * to also be what the card drew: a snapshot of the name, dose, time and start date. Editing the
 * medication afterwards (owner: Ibuprofen saved at 8:29 AM, rolled to tomorrow, then edited to
 * 8:29 PM today) left the card saying "8:29 AM · Starts tomorrow" while the real dose was due
 * tonight, and offered Mark it for a dose that no longer existed.
 *
 * Now every value the card shows comes from the series ROOT as the server has it now
 * (`GET /events/:id`, hooks/useFirstMedRoot), and the card shows only while the medication is
 * still in the situation the card is about: an active, scheduled medication whose start is
 * still past today. Anything else (deleted, discontinued/paused, made as-needed, moved onto
 * today, not loaded yet, failed to load) hides the card: Next up and Meds already show the
 * real medication, and a card that might be wrong is worse than none.
 *
 * Pure, no I/O: every date is a recipient-zone `YYYY-MM-DD` string.
 */

/** A dose row of the card: the live time, on the live date. */
export interface FirstMedLiveDose {
  /** `HH:MM[:SS]`, recipient frame, as stored on the root now. */
  time: string;
  /** `YYYY-MM-DD`, recipient frame. */
  date: string;
  starts: 'tomorrow' | 'later';
}

export type FirstMedCardState =
  | { kind: 'hidden' }
  | {
      /** Still rolled: the next-dose row, with Mark it. */
      kind: 'rolled';
      eventId: string;
      name: string;
      dose: string;
      next: FirstMedLiveDose;
    }
  | {
      /** Mark it succeeded: the Taken row, and the next dose when the series repeats. */
      kind: 'marked';
      eventId: string;
      name: string;
      dose: string;
      next: FirstMedLiveDose | null;
    };

const HIDDEN: FirstMedCardState = { kind: 'hidden' };

/** Weekly series with an explicit weekday set: is `today` (recipient zone) one of its days? */
function todayOnWeekdaySet(live: FirstMedLiveRoot, today: string): boolean {
  if (live.recurrence_rule !== 'weekly') return true;
  const days = live.recurrence_days;
  if (!Array.isArray(days) || days.length === 0) return true;
  return days.includes(getDayOfWeek(today));
}

function startsFrom(date: string, today: string): 'tomorrow' | 'later' {
  return date === addDays(today, 1) ? 'tomorrow' : 'later';
}

/**
 * What the card shows for `note` given the live root (`undefined` = not loaded / failed,
 * `null` = the server says it does not exist: deleted).
 *
 * - `note.marked` false: shown only while the live start is still AFTER today (the rolled
 *   situation) AND today's dose at the live time has already passed (`isPastToday`): that is
 *   the dose "Already given today?" asks about, and the only one the server's Mark it accepts
 *   (`mark_first_day` answers 409 NOT_FIRST_DAY for a dose instant still ahead). A start on or
 *   before today means the dose is today's, owned by Next up.
 * - `note.marked` true: the server moved the start back to today when it recorded the Taken,
 *   so the Taken row stays for the rest of the day; the next dose is the rolled date the note
 *   remembered (the roll moves by whole periods, so it is the series' next occurrence), and only
 *   for a repeating series (a one-off has no next dose once today's is taken).
 */
export function resolveFirstMedCard(args: {
  note: { eventId: string; marked: boolean; startDate: string };
  live: FirstMedLiveRoot | null | undefined;
  circleId: string;
  today: string;
  /** Has `time` (recipient wall clock) already passed TODAY in the recipient zone? */
  isPastToday: (time: string) => boolean;
}): FirstMedCardState {
  const { note, live, circleId, today, isPastToday } = args;
  if (!live) return HIDDEN;
  if (live.id !== note.eventId) return HIDDEN;
  if (live.circle_id && live.circle_id !== circleId) return HIDDEN;
  if (live.event_type !== 'medication' || live.parent_event_id) return HIDDEN;
  if (live.as_needed || live.discontinued_at) return HIDDEN;
  if (!live.scheduled_time || !live.scheduled_date) return HIDDEN;

  const name = (live.medication_name || live.title || '').trim();
  if (!name) return HIDDEN;
  const dose = (live.medication_dosage ?? '').trim();
  const start = live.scheduled_date.slice(0, 10);

  if (!note.marked) {
    if (start <= today) return HIDDEN;
    // The server's Mark it also demands that TODAY is on the series' own weekday set
    // (`dateMatchesRecurrence`, 409 NOT_FIRST_DAY otherwise): a Mon/Wed/Fri series saved on a
    // Tuesday has no dose today to mark. 0=Sun, recipient-zone `today`. Daily / no-days: unaffected.
    if (!todayOnWeekdaySet(live, today)) return HIDDEN;
    if (!isPastToday(live.scheduled_time)) return HIDDEN;
    return {
      kind: 'rolled',
      eventId: live.id,
      name,
      dose,
      next: { time: live.scheduled_time, date: start, starts: startsFrom(start, today) },
    };
  }

  // Marked. A start still after today (edited forward since) is that next dose; otherwise the
  // remembered rolled date, for a repeating series only.
  let nextDate: string | null = null;
  if (start > today) nextDate = start;
  else if (live.recurrence_rule && note.startDate > today) nextDate = note.startDate;
  return {
    kind: 'marked',
    eventId: live.id,
    name,
    dose,
    next: nextDate
      ? { time: live.scheduled_time, date: nextDate, starts: startsFrom(nextDate, today) }
      : null,
  };
}
