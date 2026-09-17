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
}

export interface PdfEmergencyContact {
  name: string;
  relationship: string;
  phone?: string | null;
  is_primary?: boolean | null;
}

export interface PdfDoctor {
  name: string;
  specialty?: string | null;
  phone?: string | null;
}

export interface PdfInsurancePlan {
  label?: string | null;
  carrier: string;
  policy_number?: string | null;
  group_number?: string | null;
  phone?: string | null;
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
}

/** One row of the report's Health Vitals table. */
export interface PdfVitalsSummary {
  /** Already-localised label ("Blood pressure"), not the raw vital type. */
  type: string;
  latest: { value1: number; value2?: number; unit: string };
  average: number;
  min: number;
  max: number;
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
