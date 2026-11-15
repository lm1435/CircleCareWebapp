import { addDays, getDayOfWeek } from '@/components/calendar/dateMath';

/**
 * What a just-saved NEW medication looks like, handed from the add form to whoever
 * follows up (the first-run payoff; the Today "Mark it" note). Wire values only: every
 * date/time is naive local in the CARE RECIPIENT's frame, exactly as stored. Held in
 * memory / one local note, never sent to analytics.
 */
export interface SavedMedicationInfo {
  /** The PRIMARY dose's event id (the series root); null when the server sent none. */
  eventId: string | null;
  name: string;
  dosage: string;
  /** Every saved dose row, primary first. */
  doses: { scheduledDate: string; scheduledTime: string }[];
  /** The recipient zone the doses were saved in. */
  timezone: string;
  /** The stored rule ('daily', 'weekly', ...) or null for a one-off. */
  recurrenceRule: string | null;
  /** The chosen weekdays (0=Sun) for a "some days" schedule, else null. */
  recurrenceDays: number[] | null;
  /** The first dose time had already passed today in the recipient zone (the start rolled). */
  startsNextDose: boolean;
  /** The server-reported start date of the primary dose, when the response carried it. */
  startDate: string | null;
  /** The recipient's today when it was saved. */
  today: string;
}

/** "HH:MM" or "HH:MM:SS" -> "HH:MM:SS". */
export function toWireTime(time: string): string {
  return /^\d{2}:\d{2}$/.test(time) ? `${time}:00` : time;
}

/** Did the start roll past today? Uses the server's date when known. */
export function startRolled(info: SavedMedicationInfo): boolean {
  if (!info.startsNextDose) return false;
  return info.startDate ? info.startDate > info.today : true;
}

/** "Already given today? Mark it" applies: a root id, a rolled start, a scheduled dose. */
export function markItEligible(info: SavedMedicationInfo): boolean {
  if (info.eventId === null || info.doses.length === 0 || !startRolled(info)) return false;
  // The server also refuses (409 NOT_FIRST_DAY) when TODAY is not one of a weekly series' chosen
  // weekdays (Mon/Wed/Fri saved on a Tuesday): no dose today, nothing to mark.
  if (info.recurrenceRule === 'weekly' && info.recurrenceDays && info.recurrenceDays.length > 0) {
    return info.recurrenceDays.includes(getDayOfWeek(info.today));
  }
  return true;
}

/** The first dose's date relative to today, for "starts today|tomorrow|<date>". */
export function startsWhen(info: SavedMedicationInfo): 'today' | 'tomorrow' | 'later' {
  const date = info.startDate ?? info.doses[0]?.scheduledDate ?? info.today;
  if (date <= info.today) return 'today';
  if (date === addDays(info.today, 1)) return 'tomorrow';
  return 'later';
}
