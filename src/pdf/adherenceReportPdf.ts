/**
 * WEB ADAPTER over `src/pdf/shared/adherenceReportTemplate.ts`.
 *
 * The document itself — markup, CSS, the day strip, every colour band and
 * formatting rule — lives in the shared, platform-pure template that mobile
 * owns and this app mirrors. This file types the options with the WEB API
 * shapes (which satisfy the template's structural `Pdf*` types without a
 * cast) and supplies the {@link PdfEnv} from `./pdfEnv`.
 */
import type { AdherenceReport } from '@/api/medicationConfirmations';
import type { PdfVitalsSummary } from './shared/types';
import type { AdherenceReportTemplateOptions } from './shared/adherenceReportTemplate';
import { renderAdherenceReportHtml } from './shared/adherenceReportTemplate';
import { buildPdfEnv } from './pdfEnv';

export interface WebAdherenceReportOptions {
  report: AdherenceReport;
  careRecipientName: string;
  circleName: string;
  careRecipientTimezone: string;
  vitalsData?: PdfVitalsSummary[];
  /** Care recipient's date of birth (YYYY-MM-DD), or null/omitted when unknown.
   *  Drives the header's "DOB … · Age …" line; the line is omitted entirely
   *  when this is absent, rather than printing a blank. */
  recipientDob?: string | null;
  /** Display name of the person who generated the export, for the header's
   *  "Prepared by" line. Omitted (not printed) when unavailable. */
  preparedBy?: string;
}

export function generateAdherenceReportHtml(options: WebAdherenceReportOptions): string {
  const shared: AdherenceReportTemplateOptions = options;
  return renderAdherenceReportHtml(shared, buildPdfEnv());
}

/**
 * The document title the print dialog's "Save as PDF" defaults to —
 * mobile's file name (`CircleCare_Adherence_<Name>_<N>d`). Whitespace runs in
 * the name become single underscores; nothing else is altered.
 */
export function adherenceReportFileTitle(recipientName: string, periodDays: number): string {
  return `CircleCare_Adherence_${recipientName.trim().replace(/\s+/g, '_')}_${periodDays}d`;
}
