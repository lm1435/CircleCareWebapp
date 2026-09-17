/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */

export { PDF_PALETTE, type PdfPaletteKey } from './palette';
export type {
  PdfCalendarEvent,
  PdfEmergencyContact,
  PdfDoctor,
  PdfInsurancePlan,
  PdfEmergencyInfo,
  PdfAdherenceReportSummary,
  PdfAdherenceReportDaily,
  PdfAdherenceReportByMedication,
  PdfAdherenceReportTimeBreakdown,
  PdfAdherenceReport,
  PdfVitalsSummary,
  PdfHealthVital,
} from './types';
export type { PdfEnv } from './env';
export {
  getSharedPdfStyles,
  PLACEHOLDER_DISPLAY,
  displayValue,
  computeAge,
  escapeHtml,
} from './pdfBranding';
export {
  renderCareSummaryHtml,
  renderCareSummaryText,
  type CareSummaryTemplateOptions,
} from './careSummaryTemplate';
export {
  renderAdherenceReportHtml,
  type AdherenceReportTemplateOptions,
} from './adherenceReportTemplate';
export { computeVitalsSummary, VITAL_TYPE_LABEL_KEYS } from './vitalsSummary';
export {
  selectCareSummaryMedications,
  collectStoppedSeries,
  addDaysToDateString,
  CARE_SUMMARY_MEDICATION_LOOKBACK_DAYS,
  type CareSummaryMedicationEvent,
  type StoppedMedication,
  type SelectCareSummaryMedicationsOptions,
  type CareSummaryMedicationSelection,
} from './medicationSelection';
