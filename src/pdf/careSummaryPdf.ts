/**
 * WEB ADAPTER over `src/pdf/shared/careSummaryTemplate.ts`.
 *
 * The document itself — markup, CSS, grouping and every formatting rule —
 * lives in the shared, platform-pure template that mobile owns and this app
 * mirrors. This file types the options with the WEB API shapes (which satisfy
 * the template's structural `Pdf*` types without a cast) and supplies the
 * {@link PdfEnv} from `./pdfEnv`.
 */
import type { EmergencyInfo } from '@/api/emergencyInfo';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { CareSummaryTemplateOptions } from './shared/careSummaryTemplate';
import { renderCareSummaryHtml, renderCareSummaryText } from './shared/careSummaryTemplate';
import { buildPdfEnv } from './pdfEnv';

export interface WebCareSummaryOptions {
  recipientName: string;
  recipientDob: string | null;
  recipientConditions: string[] | null;
  emergencyInfo: EmergencyInfo | null | undefined;
  medications: CalendarEvent[];
  careRecipientTimezone: string;
  /** Display name of the person who generated the export, for the header's
   *  "Prepared by" line. Omitted (not printed) when unavailable. */
  preparedBy?: string;
}

export function generateCareSummaryHtml(options: WebCareSummaryOptions): string {
  const shared: CareSummaryTemplateOptions = options;
  return renderCareSummaryHtml(shared, buildPdfEnv());
}

export function generateCareSummaryText(options: WebCareSummaryOptions): string {
  const shared: CareSummaryTemplateOptions = options;
  return renderCareSummaryText(shared, buildPdfEnv());
}

/**
 * The document title the print dialog's "Save as PDF" defaults to —
 * mobile's file name (`CircleCare_Summary_<Name>`), so a summary saved from
 * the web and one shared from the phone land side by side in a folder.
 * Whitespace runs become single underscores; nothing else is altered.
 */
export function careSummaryFileTitle(recipientName: string): string {
  return `CircleCare_Summary_${recipientName.trim().replace(/\s+/g, '_')}`;
}
