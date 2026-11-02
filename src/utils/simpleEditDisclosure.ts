/**
 * EDIT USES THE SIMPLE LAYOUT (owner decision, 1.4.0): editing a medication or an appointment looks
 * exactly like adding one, prefilled. The simple layout keeps optional fields behind disclosures
 * ("More details" on a medication; the Doctor / Place / Notes / Repeat rows on an appointment), so on an
 * edit a SAVED value behind one of them opens it — an edit must never hide what is stored. Mobile parity:
 * `shouldExpandMoreDetails` + `shouldExpandSimpleMoreDetails` (mobile utils/medicationDetails.ts) and the
 * hydration of the Place / Notes rows in AddEventScreen.
 */

export interface SimpleEditDisclosureSource {
  description?: string | null;
  location?: string | null;
  provider_id?: string | null;
  recurrence_rule?: string | null;
  recurrence_days?: number[] | null;
  recurrence_end_date?: string | null;
}

/**
 * A repeat "How often?" cannot name (monthly, every other day, yearly, a cycle, weekly with no days).
 * Every day, some days and as needed (no rule) are its own answers, and no rule at all is a one-off.
 */
export function isRepeatHowOftenCannotName(source: SimpleEditDisclosureSource): boolean {
  const rule = source.recurrence_rule ?? null;
  if (rule === null || rule === 'daily') return false;
  if (rule === 'weekly') return !(Array.isArray(source.recurrence_days) && source.recurrence_days.length > 0);
  return true;
}

/** The simple medication form's "More details" (start date, instructions, repeat, end date, reminders). */
export function simpleMedicationMoreOpen(source: SimpleEditDisclosureSource): boolean {
  return !!(
    source.description?.trim() ||
    (source.recurrence_rule && source.recurrence_end_date) ||
    isRepeatHowOftenCannotName(source)
  );
}

/** The simple appointment form's rows a saved value opens. */
export function simpleAppointmentOpenRows(source: SimpleEditDisclosureSource): Record<string, boolean> {
  const rows: Record<string, boolean> = {};
  if (source.provider_id) rows.doctor = true;
  if (source.location?.trim()) rows.place = true;
  if (source.description?.trim()) rows.notes = true;
  if (source.recurrence_rule) rows.repeat = true;
  return rows;
}
