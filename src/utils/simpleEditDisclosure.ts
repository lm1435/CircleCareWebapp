/**
 * EDIT USES THE SIMPLE LAYOUT (owner decision, 1.4.0): editing a medication, an appointment or a task looks
 * exactly like adding one, prefilled. The simple layout keeps optional fields behind disclosures
 * ("More details" on every one of them), so on an
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
 * The simple medication form's "More details" (instructions, end date, reminders). Every repeat rule has a
 * "How often?" answer now (Custom… holds the rarer ones) and the start date sits in "When?", so only the
 * instructions and a repeat end date open it.
 */
export function simpleMedicationMoreOpen(source: SimpleEditDisclosureSource): boolean {
  return !!(source.description?.trim() || (source.recurrence_rule && source.recurrence_end_date));
}

/** What the simple appointment form's "More details" needs from a saved appointment. */
export interface SimpleAppointmentDisclosureSource extends SimpleEditDisclosureSource {
  scheduled_time?: string | null;
  duration_minutes?: number | null;
}

/**
 * The simple appointment form's "More details" (doctor, location, notes, end date, reminders): opened on an edit
 * by a linked doctor, a location, notes, or a repeat end date. The length is NOT in it any more (owner
 * 2026-11-10: Starts | Ends and the length chips sit under the time choice), so a non-default length no longer
 * opens it. Mobile twin: the same rule in AddEventScreen.
 */
export function simpleAppointmentMoreOpen(
  source: SimpleAppointmentDisclosureSource,
  // Kept for the call sites' shape (the task rule still uses its twin); the length no longer opens it.
  _defaultDurationMinutes?: number
): boolean {
  return !!(
    source.provider_id ||
    source.location?.trim() ||
    source.description?.trim() ||
    (source.recurrence_rule && source.recurrence_end_date)
  );
}

/** What the simple task form's "More details" needs from a saved task, beyond the repeat fields. */
export interface SimpleTaskDisclosureSource extends SimpleEditDisclosureSource {
  scheduled_time?: string | null;
  duration_minutes?: number | null;
}

/**
 * The simple task form's "More details" (details, duration + end time, end date, reminders): opened on an edit by details, a duration other than the default a new time gets, a repeat end
 * date (every repeat rule has a How often? answer). Mobile twin: the same rule in AddEventScreen.
 */
export function simpleTaskMoreOpen(source: SimpleTaskDisclosureSource, defaultDurationMinutes: number): boolean {
  return !!(
    source.description?.trim() ||
    (source.scheduled_time && source.duration_minutes && source.duration_minutes !== defaultDurationMinutes) ||
    (source.recurrence_rule && source.recurrence_end_date)
  );
}
