/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */
import type { PdfEnv } from './env';
import { PDF_PALETTE as CC } from './palette';

/**
 * Common CSS used across all PDF exports.
 *
 * CAREFUL: this is a template literal. A backtick inside a CSS comment ends
 * the string and breaks the module — write "grave accent" or nothing.
 */
export function getSharedPdfStyles(): string {
  return `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      /* Print BACKGROUNDS. WebKit (iOS printToFileAsync) and Chrome both drop
         every background colour when printing unless told otherwise: the day
         squares, legend swatches, table header shading and summary tiles all
         came out blank on a real iOS 26.6 export. Borders survive, which is
         why the allergy box looked fine while the rest did not. */
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    /* Android WebView and browsers honour this. iOS IGNORES it and takes the
       margins from the native print call instead (PDF_PAGE_MARGINS_PT in
       mobile/src/utils/pdfExport.ts) -- keep the two equal. 0.75in = 54pt. */
    @page { size: letter; margin: 0.75in; }
    body {
      font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 12px;
      color: ${CC.ink};
      line-height: 1.5;
      padding: 0;
    }
    .header-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid ${CC.moss};
      padding-bottom: 16px;
      margin-bottom: 28px;
    }
    .brand-row { display: flex; align-items: center; }
    .brand { color: ${CC.moss}; font-size: 22px; font-weight: 700; }
    section, .section {
      margin-bottom: 24px;
      /* Sections FLOW across pages. An "avoid" here pushed a whole tall section
         (title + 30-row table) to the next page, leaving the previous one
         half empty and orphaning the footer on a page of its own. Rows and
         headings protect themselves below. */
      break-inside: auto;
      page-break-inside: auto;
    }
    h2, .section-title {
      break-after: avoid;
      page-break-after: avoid;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    /* Small blocks that must not split: a header, a stat row, a callout. */
    .keep-together { break-inside: avoid; page-break-inside: avoid; }
    .subsection-title {
      font-size: 13px;
      font-weight: 700;
      color: ${CC.ink};
      margin: 16px 0 8px;
      break-after: avoid;
      page-break-after: avoid;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      page-break-inside: auto;
    }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; page-break-after: auto; }
    tr.muted td { color: ${CC.inkSoft}; }
    td .sub { display: block; font-size: 10px; color: ${CC.inkSoft}; margin-top: 2px; }
    th {
      background: ${CC.mossWash};
      color: ${CC.mossInk};
      font-weight: 600;
      text-align: left;
      padding: 10px 10px;
      border-bottom: 1px solid ${CC.hair};
    }
    td { padding: 10px 10px; border-bottom: 1px solid ${CC.paperDeep}; }
    tr:nth-child(even) { background: ${CC.paper}; }
    .legend {
      font-size: 11px;
      color: ${CC.inkSoft};
    }
    .swatch-legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 14px;
      font-size: 11px;
      color: ${CC.inkSoft};
      margin-top: 6px;
    }
    .swatch {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      margin-right: 5px;
      vertical-align: -1px;
    }
    .footer {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 1px solid ${CC.hair};
      text-align: center;
      color: ${CC.inkSoft};
      font-size: 10px;
      page-break-inside: avoid;
    }
    .confidential {
      color: ${CC.terracotta};
      font-size: 10px;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  `;
}

/**
 * The glyph a placeholder value collapses to. Exported (rather than inlined
 * everywhere `displayValue` is compared against) so a caller deciding whether
 * to print a parenthetical or a "Stopped" clause can ask "did this resolve to
 * the placeholder?" without restating the literal.
 */
export const PLACEHOLDER_DISPLAY = '—'; // em dash

/**
 * The strings a form or an import leaves behind that mean "nothing was
 * entered here", not an actual value. Case-insensitive, trimmed.
 */
const PLACEHOLDER_VALUES = new Set(['', 'n/a', 'na', 'none', '-']);

/**
 * A cell value for a PDF table: the trimmed string, or {@link PLACEHOLDER_DISPLAY}
 * when it is empty or one of the placeholder tokens ("N/A", "na", "none", "-")
 * a form or an imported record leaves behind. Printing "N/A" or a bare "-" in a
 * clinical document reads as a VALUE ("policy number: N/A") rather than as
 * "not provided" — the em dash is unambiguous either way.
 */
export function displayValue(value: string | null | undefined): string {
  if (value == null) return PLACEHOLDER_DISPLAY;
  const trimmed = value.trim();
  if (PLACEHOLDER_VALUES.has(trimmed.toLowerCase())) return PLACEHOLDER_DISPLAY;
  return trimmed;
}

/**
 * Age in whole years as of TODAY IN THE RECIPIENT'S TIMEZONE — not the
 * device's, and not a UTC-instant subtraction, either of which can be a day
 * off around a birthday that falls near midnight.
 *
 * `dob` and "today" are both compared as plain Y-M-D components, so there is
 * no instant-to-wall-clock conversion to get wrong here — `getDateInTimezone`
 * already did that work.
 */
export function computeAge(
  dob: string,
  timezone: string,
  env: Pick<PdfEnv, 'getDateInTimezone'>
): number {
  const today = env.getDateInTimezone(timezone, new Date());
  const [ty, tm, td] = today.split('-').map(Number);
  const [by, bm, bd] = dob.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return age;
}

/** HTML-escape a text node or attribute value. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
