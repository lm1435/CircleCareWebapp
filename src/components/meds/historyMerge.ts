import type { AsNeededDoseWithEvent } from '@/api/medicationAsNeeded';
import { getDateInTimezone } from '@/utils/timezone';
import type { HistoryConfirmation } from './historyQuery';

// The History tab's day grouping: scheduled confirmations AND as-needed (PRN)
// doses in one list, grouped by day IN THE CARE RECIPIENT'S ZONE, newest day
// first. Pure, so the zone/ordering rules are unit-tested.
//
// A dose's day is the recipient-zone day of its INSTANT `given_at` — never the
// browser's zone and never `given_at.split('T')[0]` (a UTC date).

export interface HistoryDayGroup {
  date: string;
  confirmations: HistoryConfirmation[];
  /** PRN doses, newest first, shown after the day's scheduled rows. */
  doses: AsNeededDoseWithEvent[];
}

/** The medication NAME the filter and the rows use. */
export function doseMedicationName(dose: AsNeededDoseWithEvent): string {
  return dose.event?.medication_name || dose.event?.title || '';
}

/** Recipient-zone day of a dose, or null for an unparseable instant. */
export function doseDay(dose: AsNeededDoseWithEvent, timezone: string): string | null {
  const at = new Date(dose.given_at);
  if (Number.isNaN(at.getTime())) return null;
  return getDateInTimezone(timezone, at);
}

export function mergeHistoryDays(
  confirmations: HistoryConfirmation[],
  doses: AsNeededDoseWithEvent[],
  timezone: string,
  medicationName: string | null
): HistoryDayGroup[] {
  const filteredConfirmations = medicationName
    ? confirmations.filter((c) => (c.event?.medication_name || c.event?.title) === medicationName)
    : confirmations;
  const filteredDoses = medicationName
    ? doses.filter((d) => doseMedicationName(d) === medicationName)
    : doses;

  const byDay = new Map<string, HistoryDayGroup>();
  const bucket = (date: string): HistoryDayGroup => {
    let group = byDay.get(date);
    if (!group) {
      group = { date, confirmations: [], doses: [] };
      byDay.set(date, group);
    }
    return group;
  };

  for (const confirmation of filteredConfirmations) {
    // The dose's OWN day when the join carries it; otherwise the day the
    // confirmation landed, read in the recipient's zone (mobile parity).
    const key =
      confirmation.event?.scheduled_date ||
      getDateInTimezone(timezone, new Date(confirmation.confirmed_at));
    bucket(key).confirmations.push(confirmation);
  }
  for (const dose of filteredDoses) {
    const day = doseDay(dose, timezone);
    if (day) bucket(day).doses.push(dose);
  }

  return [...byDay.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const group = byDay.get(date)!;
      return {
        date,
        confirmations: group.confirmations
          .slice()
          .sort((a, b) => (a.scheduled_time || '').localeCompare(b.scheduled_time || '')),
        doses: group.doses.slice().sort((a, b) => Date.parse(b.given_at) - Date.parse(a.given_at)),
      };
    });
}

/**
 * Filter options: scheduled medication names first (first-seen order), then
 * as-needed names not already present.
 */
export function mergedMedicationOptions(
  scheduled: { id: string; name: string }[],
  doses: AsNeededDoseWithEvent[]
): { id: string; name: string }[] {
  const seen = new Map<string, { id: string; name: string }>();
  for (const option of scheduled) seen.set(option.id, option);
  for (const dose of doses) {
    const name = doseMedicationName(dose);
    if (name && !seen.has(name)) seen.set(name, { id: name, name });
  }
  return [...seen.values()];
}
