import type { AsNeededDoseWithEvent } from '@/api/medicationAsNeeded';
import { getDateInTimezone } from '@/utils/timezone';

// As-needed (PRN) medications are NOT calendar events (they have no schedule).
// The calendar only marks the days on which a dose was LOGGED, and lists, per
// medication, how many. Pure and unit-tested: the day of a dose is the
// recipient-zone day of its INSTANT — never the device's day, never a UTC date.

export interface AsNeededDayEntry {
  eventId: string;
  name: string;
  /** Live (non-removed) doses that day. */
  count: number;
}

export function groupDosesByDay(
  doses: AsNeededDoseWithEvent[],
  timezone: string
): Map<string, AsNeededDayEntry[]> {
  const byDay = new Map<string, Map<string, AsNeededDayEntry>>();
  for (const dose of doses) {
    // A removed dose is a tombstone, not a dose that was given.
    if (dose.removed_at) continue;
    const at = new Date(dose.given_at);
    if (Number.isNaN(at.getTime())) continue;
    const day = getDateInTimezone(timezone, at);
    const eventId = dose.event?.id ?? dose.event_id;
    const name = dose.event?.medication_name || dose.event?.title || '';
    let meds = byDay.get(day);
    if (!meds) {
      meds = new Map();
      byDay.set(day, meds);
    }
    const entry = meds.get(eventId);
    if (entry) entry.count += 1;
    else meds.set(eventId, { eventId, name, count: 1 });
  }
  const result = new Map<string, AsNeededDayEntry[]>();
  for (const [day, meds] of byDay) result.set(day, [...meds.values()]);
  return result;
}
