/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */

/**
 * STRUCTURAL input shapes for the PDF templates: only the fields the templates
 * actually read. Both apps' API types (`mobile/src/api/*`, `webapp/src/api/*`)
 * satisfy these without a cast — a required field in an app type satisfies an
 * optional one here, and nothing here names a field the templates never touch.
 */

/** A calendar event as the care summary's medications table reads it. */
export interface PdfCalendarEvent {
  title: string;
  medication_name?: string | null;
  medication_dosage?: string | null;
  /** YYYY-MM-DD, recipient zone. */
  scheduled_date: string;
  /** `HH:MM` or `HH:MM:SS`, recipient zone. */
  scheduled_time?: string | null;
  recurrence_rule?: string | null;
  recurrence_days?: number[] | null;
  /** A real UTC instant when the series was stopped; absent/null while active. */
  discontinued_at?: string | null;
  /** Naive `YYYY-MM-DD` (recipient frame) a course ended on via "This and future";
   *  with no `discontinued_at` it makes a recurring course "stopped" in the summary. */
  recurrence_end_date?: string | null;
  /** As-needed (PRN) medication: listed with a blank Time and Frequency "As needed". */
  as_needed?: boolean | null;
  /** Optional plain note ("pain"); printed as "As needed · pain". No limits exist. */
  as_needed_reason?: string | null;
}

export interface PdfEmergencyContact {
  name: string;
  relationship: string;
  phone?: string | null;
  /** Calling code ("+49"); printed before the phone ("+49 030 12345678"). */
  country_code?: string | null;
  is_primary?: boolean | null;
}

export interface PdfDoctor {
  name: string;
  specialty?: string | null;
  phone?: string | null;
  country_code?: string | null;
  /** 1-10 digits; printed after the phone ("ext. 42"). */
  phone_extension?: string | null;
}

export interface PdfInsurancePlan {
  label?: string | null;
  carrier: string;
  policy_number?: string | null;
  group_number?: string | null;
  phone?: string | null;
  country_code?: string | null;
  phone_extension?: string | null;
  rx_bin?: string | null;
  rx_pcn?: string | null;
  rx_group?: string | null;
}

/** The emergency-info record as the care summary reads it. */
export interface PdfEmergencyInfo {
  insurance_plans?: PdfInsurancePlan[] | null;
  primary_doctor_name?: string | null;
  primary_doctor_specialty?: string | null;
  primary_doctor_phone?: string | null;
  primary_doctor_country_code?: string | null;
  primary_doctor_phone_extension?: string | null;
  additional_doctors?: PdfDoctor[] | null;
  allergies?: string[] | null;
  medication_allergies?: string[] | null;
  blood_type?: string | null;
  emergency_contacts?: PdfEmergencyContact[] | null;
  advance_directives?: string | null;
  has_dnr?: boolean | null;
}

export interface PdfAdherenceReportSummary {
  total_scheduled: number;
  taken: number;
  taken_late: number;
  not_marked: number;
  skipped: number;
  adherence_rate: number;
  trend: 'improving' | 'declining' | 'stable';
  trend_change: number;
  /** PK25: false = either half of the window had nothing due; hide the badge. Absent = available. */
  trend_available?: boolean;
}

export interface PdfAdherenceReportDaily {
  /** YYYY-MM-DD */
  date: string;
  taken: number;
  not_marked: number;
  skipped: number;
  total: number;
  adherence_rate: number;
}

export interface PdfAdherenceReportByMedication {
  name: string;
  dosage: string | null;
  taken: number;
  not_marked: number;
  skipped: number;
  total: number;
  adherence_rate: number;
}

export interface PdfAdherenceReportTimeBreakdown {
  /** `HH:MM`, recipient zone. */
  time: string;
  taken: number;
  not_marked: number;
  total: number;
  adherence_rate: number;
}

/** One logged as-needed (PRN) dose, as the report's as-needed section lists it. */
export interface PdfAsNeededDose {
  id?: string;
  /** Real UTC instant (ISO) the dose was given. */
  given_at: string;
  given_by_name?: string | null;
  note?: string | null;
}

/** One as-needed medication in the report's as-needed section. NOT part of any ratio. */
export interface PdfAsNeededMedication {
  event_id?: string;
  medication_name: string;
  medication_dosage?: string | null;
  doses_given: number;
  doses: PdfAsNeededDose[];
}

/** The adherence report as the report template reads it. */
export interface PdfAdherenceReport {
  /** YYYY-MM-DD */
  start_date: string;
  /** YYYY-MM-DD */
  end_date: string;
  summary: PdfAdherenceReportSummary;
  daily_breakdown: PdfAdherenceReportDaily[];
  by_medication: PdfAdherenceReportByMedication[];
  time_breakdown: PdfAdherenceReportTimeBreakdown[];
  /** Plain record of as-needed doses in the window; `null`/absent = none (or soft-failed). */
  as_needed?: { medications: PdfAsNeededMedication[] } | null;
}

/** One point of a vital's trend line: ISO instant, systolic/primary value, optional diastolic. */
export interface PdfVitalsSeriesPoint {
  at: string;
  value1: number;
  value2?: number;
}

/** One row of the report's Health Vitals table. */
export interface PdfVitalsSummary {
  /** Already-localised label ("Blood pressure"), not the raw vital type. */
  type: string;
  latest: { value1: number; value2?: number; unit: string };
  average: number;
  min: number;
  max: number;
  /** Blood pressure only: mean diastolic (rounded like `average`). */
  average2?: number;
  /** Blood pressure only: the whole reading with the lowest systolic. */
  minReading?: { value1: number; value2?: number };
  /** Blood pressure only: the whole reading with the highest systolic. */
  maxReading?: { value1: number; value2?: number };
  /** Trend points, ascending by time, at most 120. Absent on summaries built by older code. */
  series?: PdfVitalsSeriesPoint[];
}

/** A recorded vital as `computeVitalsSummary` reads it. */
export interface PdfHealthVital {
  vital_type: string;
  value1: number;
  value2?: number | null;
  unit: string;
  /** ISO instant. */
  recorded_at: string;
}

/** One appointment/task/dose note, as the care summary's "Visit notes"
 *  section reads it. `date` is the event's `scheduled_date` (YYYY-MM-DD,
 *  recipient zone) — never the note's `created_at` instant. */
export interface CareSummaryVisitNote {
  date: string;
  eventTitle: string;
  authorFirstName: string | null;
  body: string;
}

/** One Daily Care Notes journal entry, as the care summary's "Daily care
 *  notes" section reads it. `body` is null for a mood-only note; `mood` is
 *  null for a note with no mood set — never both null (nothing to print). */
export interface CareSummaryCareNote {
  date: string;
  authorFirstName: string | null;
  body: string | null;
  mood: 'great' | 'good' | 'okay' | 'tough' | null;
}

/** The four canonical Daily Care Note moods, in display order (best → hardest). */
export type PdfCareNoteMood = 'great' | 'good' | 'okay' | 'tough';

/** A Daily Care Note as `computeMoodSummary` reads it. ONLY the day and the
 *  mood: the note's body never enters the adherence report. `mood` is typed
 *  loosely because a newer server may send a mood this build does not know;
 *  unknown values are ignored, never printed. */
export interface PdfMoodNote {
  /** Used to de-duplicate a note returned by two fetch windows. */
  id?: string;
  /** YYYY-MM-DD in the care recipient's timezone. */
  note_date: string;
  mood?: string | null;
}

/** Mood counts for one block of days of the report period. */
export interface PdfMoodBucket {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /** YYYY-MM-DD, inclusive (clamped to the period end). */
  end: string;
  counts: Record<PdfCareNoteMood, number>;
}

/** The adherence report's "Day ratings" section, as the template reads it. */
export interface PdfMoodSummary {
  /** Totals over the whole period, one count per NOTE that carries a mood. */
  counts: Record<PdfCareNoteMood, number>;
  /** Notes with a known mood inside the period. Always > 0. */
  ratedNotes: number;
  /** Distinct days with at least one rated note. */
  ratedDays: number;
  /** Inclusive day count of the period (start..end). */
  periodDays: number;
  /** Consecutive blocks covering the whole period, oldest first, empty ones
   *  included. Counted back from the period END, so only the oldest may be short. */
  buckets: PdfMoodBucket[];
  /** Distinct days with at least one 'tough' note, oldest first. */
  toughDays: string[];
}
