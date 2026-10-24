/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */
import type { PdfEnv } from './env';
import type {
  PdfAdherenceReport,
  PdfAdherenceReportByMedication,
  PdfAdherenceReportDaily,
  PdfAsNeededMedication,
  PdfVitalsSummary,
} from './types';
import { PDF_PALETTE as CC } from './palette';
import { getSharedPdfStyles, displayValue, computeAge, escapeHtml } from './pdfBranding';

/**
 * SUMMARY TILE LABELS NEVER BREAK MID-WORD, IN ANY LOCALE.
 *
 * On the iOS print width (504pt of content; six tiles in one row) a tile has
 * ~73px of interior. Uppercase 9px labels broke "TASA DE ADHERENCIA" as
 * "ADHERENCI / A" (overflow-wrap: break-word), and German was worse
 * ("EINNAHMETR / EUE", "EINGENOMME / N", "AUSGELASSE / N"). Labels now print in
 * the sentence case they are written in, and ONE font size per document is
 * chosen so the longest single word of the six labels fits a tile; multi-word
 * labels wrap only between words. 0.6em is a conservative per-character width
 * for this font stack (measured: 0.44-0.59em for mixed-case words), and the
 * budget leaves ~10% for iOS rendering wider than desktop Chrome.
 */
export const SUMMARY_TILE_LABEL_BUDGET_PX = 65;
export const SUMMARY_TILE_LABEL_MAX_PX = 10;
export const SUMMARY_TILE_LABEL_MIN_PX = 7;
export function summaryTileLabelFontPx(labels: string[]): number {
  const longestWord = labels
    .flatMap((label) => label.split(/\s+/))
    .reduce((max, word) => Math.max(max, Array.from(word).length), 0);
  if (longestWord === 0) return SUMMARY_TILE_LABEL_MAX_PX;
  const fit = Math.floor((SUMMARY_TILE_LABEL_BUDGET_PX / (longestWord * 0.6)) * 2) / 2;
  return Math.min(SUMMARY_TILE_LABEL_MAX_PX, Math.max(SUMMARY_TILE_LABEL_MIN_PX, fit));
}

/**
 * A heading and the block it introduces print on the same page. Chrome honours
 * the shared `break-after: avoid` on headings; iOS WebKit (expo-print) does NOT,
 * which left "Daily breakdown" alone at the foot of page 1 with its strip on
 * page 2. WebKit does honour `break-inside: avoid`, so each heading is wrapped
 * with its content in a `keep-together` block. A table longer than this many
 * rows cannot be held on one page, so it flows (its header row repeats).
 */
export const KEEP_WITH_HEADING_MAX_ROWS = 12;
function keepWithHeading(rows: number): string {
  return rows <= KEEP_WITH_HEADING_MAX_ROWS ? ' keep-together' : '';
}

/** " mmHg", " kg", " °C" after a value; a percentage takes its sign with no space ("96%"). */
function vitalUnitSuffix(unit: string): string {
  return unit === '%' ? '%' : ` ${escapeHtml(unit)}`;
}

/**
 * Format a YYYY-MM-DD date string for PDF display.
 * Uses T12:00:00Z + timeZone: 'UTC' to avoid timezone date-shift.
 */
function formatDateForPdf(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The date half of a timestamp, in a specific timezone. Split out of
 * {@link formatTimestamp} so the header's "Prepared on" line — which needs the
 * date but never the time — can share it rather than re-deriving it.
 */
function formatDateOnly(now: Date, timezone: string, locale: string): string {
  return now.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  });
}

/**
 * Format the current timestamp in a specific timezone for the PDF footer.
 *
 * SPLIT IN TWO ON PURPOSE. The date half is Intl's job — month names are
 * language. The time half is not: `toLocaleString(locale, …)` derives 12h/24h
 * from the LOCALE, so this footer printed "20:12" under `es` while the dose
 * table one page up printed "8:00 p. m." for the same clock. The time goes
 * through the app's one formatter, exactly as every other surface does.
 */
function formatTimestamp(timezone: string, env: PdfEnv): string {
  const now = new Date();
  return `${formatDateOnly(now, timezone, env.locale)}, ${env.formatInstantTimeOfDay(now, timezone)}`;
}

/**
 * Format a naive `HH:MM` dose slot — already in the recipient's zone — for the
 * report table, in that ONE zone.
 *
 * A caregiver's PDF used to print BOTH clocks ("8:00 AM (Denver) / 10:00 AM
 * (New York)") the way a screen does for a viewer in a different zone. A
 * document has no "viewer's zone" to render against — it is read off-device,
 * later, by anyone — and the header already states whose clock the sheet is
 * on, so the second half was noise repeated on every row. Renders the bare
 * wall-clock time on the device's 12h/24h convention, resolved for the
 * recipient's zone; never appends a zone label here.
 */
function formatTimeSlot(timeStr: string, timezone: string, env: PdfEnv): string {
  const [hoursStr, minutesStr] = timeStr.split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  if (isNaN(hours) || isNaN(minutes)) return timeStr;
  return env.formatTimeOfDay(hours, minutes, timezone);
}

/** Background/foreground pair for one calendar-strip day cell, by rate. */
function getDayCellColors(day: PdfAdherenceReportDaily): { bg: string; fg: string } {
  if (day.total === 0) return { bg: CC.paperDeep, fg: CC.ink };
  if (day.adherence_rate >= 100) return { bg: CC.moss, fg: '#FFFFFF' };
  if (day.adherence_rate >= 75) return { bg: CC.mossMuted, fg: CC.ink };
  // Ink, not white, on amber: white measured 3.70:1 (under WCAG 1.4.3 AA for
  // the day number); ink is 4.75:1. The amber stays, so the scale keeps its hue.
  if (day.adherence_rate >= 50) return { bg: CC.amber, fg: CC.ink };
  return { bg: CC.terracotta, fg: '#FFFFFF' };
}

/** "Aug 7" — the strip cell's tooltip date, deliberately without a year. */
function formatShortDayForPdf(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function getAdherenceColor(rate: number): string {
  if (rate >= 80) return CC.moss;
  if (rate >= 50) return CC.amberDeep;
  return CC.terracotta;
}

function getTrendArrow(trend: string): string {
  if (trend === 'improving') return '&#x2191;'; // ↑
  if (trend === 'declining') return '&#x2193;'; // ↓
  return '&#x2194;'; // ↔
}

function getTrendColor(trend: string): string {
  if (trend === 'improving') return CC.moss;
  if (trend === 'declining') return CC.terracotta;
  return CC.inkSoft;
}

/**
 * What the adherence report prints. `t` and `locale` are NOT here — they
 * arrive on the {@link PdfEnv} with every other platform concern, so this
 * shape is the same object on mobile and web.
 */
/** Merge `by_medication` rows that share a normalised name + dosage. */
function mergeByMedication(rows: PdfAdherenceReportByMedication[]): PdfAdherenceReportByMedication[] {
  const normalise = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase();
  const order: string[] = [];
  const merged = new Map<string, PdfAdherenceReportByMedication>();
  for (const row of rows) {
    const key = `${normalise(row.name)}|${normalise(row.dosage)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      order.push(key);
      continue;
    }
    existing.taken += row.taken;
    existing.not_marked += row.not_marked;
    existing.skipped += row.skipped;
    existing.total += row.total;
    existing.adherence_rate = existing.total > 0 ? Math.round((existing.taken / existing.total) * 100) : 0;
  }
  return order.map((key) => merged.get(key)!);
}

export interface AdherenceReportTemplateOptions {
  report: PdfAdherenceReport;
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

export function renderAdherenceReportHtml(options: AdherenceReportTemplateOptions, env: PdfEnv): string {
  const { report, careRecipientName, circleName, careRecipientTimezone, vitalsData, recipientDob, preparedBy } = options;
  const { t, locale } = env;
  const { summary, by_medication, daily_breakdown, time_breakdown } = report;

  const langCode = locale.split('-')[0];
  // The report header states the recipient's zone unconditionally — a PDF a
  // caregiver hands to a doctor is read away from the app, by someone whose own
  // zone we cannot know, so "whose clock is this?" always needs an answer here.
  // Inside the tables the per-row suffix still suppresses itself when the
  // exporter shares the zone. Named from the export's OWN locale rather than
  // the ambient i18next language, which is what the rest of this file does.
  const tzLabel = env.getTimezoneLabel(careRecipientTimezone, langCode);
  const startDateFormatted = formatDateForPdf(report.start_date, locale);
  const endDateFormatted = formatDateForPdf(report.end_date, locale);
  const preparedOnDate = formatDateOnly(new Date(), careRecipientTimezone, locale);
  const dobFormatted = recipientDob ? formatDateForPdf(recipientDob, locale) : null;
  const age = recipientDob ? computeAge(recipientDob, careRecipientTimezone, env) : null;
  const dobAgeLine = dobFormatted && age != null
    ? t('medicationHistory.export.dobAge', { dob: dobFormatted, age })
    : null;
  // Each date is a no-wrap unit (PK26): the Spanish range ("1 de septiembre de 2026 al
  // 30 de septiembre de 2026") is long enough to wrap, and a wrap INSIDE a date left the
  // year alone on its own line ("... al 30 sept / 2026"). Whole dates now wrap as units.
  const noWrap = (text: string): string => `<span style="white-space:nowrap">${escapeHtml(text)}</span>`;
  const reportTitleHtml = `${escapeHtml(t('medicationHistory.export.title'))} · ${t('medicationHistory.export.dateRange', { start: noWrap(startDateFormatted), end: noWrap(endDateFormatted) })}`;
  const adherenceColor = getAdherenceColor(summary.adherence_rate);
  const trendKey = summary.trend === 'improving'
    ? 'medicationHistory.export.improving'
    : summary.trend === 'declining'
      ? 'medicationHistory.export.declining'
      : 'medicationHistory.export.stable';
  // PK25: the server sends `trend_available: false` when either half of the window has no
  // dose due (a medication that started mid-window). The direction is then meaningless
  // ("Improving (+80%)" for a med that simply began), so no badge prints. Absent (older
  // server) = available, exactly as before.
  const showTrend = summary.trend_available !== false;
  const trendLabel = t(trendKey);
  const trendArrow = getTrendArrow(summary.trend);
  const trendColor = getTrendColor(summary.trend);

  // Only show circle name if it differs from the recipient name
  const showCircleName = circleName.trim().toLowerCase() !== careRecipientName.trim().toLowerCase();

  // Cap daily breakdown at 30 most recent rows
  const recentDaily = daily_breakdown.slice(-30);

  // By medication rows
  // One row per MEDICATION, not per dose-time series. The backend reports
  // `by_medication` per series, so "Metformin 500mg" at 8 AM and 8 PM arrived
  // as two identical-looking rows with half the doses each. Same name + same
  // dose (whitespace/case-insensitive, as the roster groups them) is merged and
  // its rate recomputed from the summed counts.
  const mergedByMedication = mergeByMedication(by_medication);
  const medRows = mergedByMedication
    .map(
      (med) => `
      <tr>
        <td>${escapeHtml(med.name)}</td>
        <td>${escapeHtml(displayValue(med.dosage))}</td>
        <td style="text-align:center">${med.taken}</td>
        <td style="text-align:center">${med.not_marked}</td>
        <td style="text-align:center">${med.skipped}</td>
        <td style="text-align:center;color:${getAdherenceColor(med.adherence_rate)};font-weight:600">${med.adherence_rate}%</td>
      </tr>`
    )
    .join('');

  // Calendar strip: one small cell per day, coloured by that day's rate.
  // Replaces the old 30-row table, which for a mostly-adherent period read as
  // thirty near-identical lines ("4 4 0 0 100%"). The exact counts move to the
  // exceptions table below, for the days that actually need a look.
  //
  // Cells are grouped under a MONTH label. A bare run of "16 17 … 31 1 2 3"
  // made the reader work out for themselves where August became September.
  const dayCell = (day: PdfAdherenceReportDaily): string => {
    const { bg, fg } = getDayCellColors(day);
    const dayNum = parseInt(day.date.split('-')[2], 10);
    const title = t('medicationHistory.export.dayCellTitle', {
      date: formatShortDayForPdf(day.date, locale),
      taken: day.taken,
      total: day.total,
    });
    return `<div class="day-cell" style="background:${bg};color:${fg}" title="${escapeHtml(title)}">${dayNum}</div>`;
  };
  const spansYears = recentDaily.length > 0
    && recentDaily[0].date.slice(0, 4) !== recentDaily[recentDaily.length - 1].date.slice(0, 4);
  const monthGroups: { label: string; cells: string[] }[] = [];
  for (const day of recentDaily) {
    const monthKey = day.date.slice(0, 7);
    const last = monthGroups[monthGroups.length - 1];
    if (!last || last.label !== monthKey) {
      monthGroups.push({ label: monthKey, cells: [dayCell(day)] });
    } else {
      last.cells.push(dayCell(day));
    }
  }
  const dayStrip = monthGroups
    .map((group) => {
      const monthName = new Date(`${group.label}-01T12:00:00Z`).toLocaleDateString(locale, {
        month: 'short',
        ...(spansYears ? { year: 'numeric' as const } : {}),
        timeZone: 'UTC',
      });
      return `<div class="month-group"><div class="month-label">${escapeHtml(monthName)}</div><div class="day-cells">${group.cells.join('')}</div></div>`;
    })
    .join('');

  // The strip's legend: the ACTUAL colours with their thresholds. The old
  // one-liner ("darker means more doses") described a ramp the cells never
  // used — they are green / light green / amber / red / grey by band.
  // Keys are LITERAL at each call so the translation-coverage scan can resolve
  // them (it counts every dynamic `t(variable)` site).
  const legendSwatch = (bg: string, label: string) =>
    `<span><span class="swatch" style="background:${bg}"></span>${escapeHtml(label)}</span>`;
  const dayLegend = `<div class="swatch-legend">
      ${legendSwatch(CC.moss, t('medicationHistory.export.legendFull'))}
      ${legendSwatch(CC.mossMuted, t('medicationHistory.export.legendMost'))}
      ${legendSwatch(CC.amber, t('medicationHistory.export.legendHalf'))}
      ${legendSwatch(CC.terracotta, t('medicationHistory.export.legendLow'))}
      ${legendSwatch(CC.paperDeep, t('medicationHistory.export.legendNone'))}
    </div>`;

  // Only the days that fell short — this is the list a clinician actually
  // needs to look at, not all thirty.
  const exceptionDays = recentDaily.filter((day) => day.taken < day.total);
  const exceptionRows = exceptionDays
    .map(
      (day) => `
      <tr>
        <td>${formatDateForPdf(day.date, locale)}</td>
        <td style="text-align:center">${day.total}</td>
        <td style="text-align:center">${day.taken}</td>
        <td style="text-align:center">${day.not_marked}</td>
        <td style="text-align:center">${day.skipped}</td>
      </tr>`
    )
    .join('');

  // Time breakdown rows — format times as "8:00 AM" instead of "08:00"
  // Backend doesn't return skipped explicitly; derive from total - taken - not_marked
  const timeRows = time_breakdown
    .map(
      (slot) => {
        const skipped = Math.max(0, slot.total - slot.taken - slot.not_marked);
        return `
      <tr>
        <td>${formatTimeSlot(slot.time, careRecipientTimezone, env)}</td>
        <td style="text-align:center">${slot.total}</td>
        <td style="text-align:center">${slot.taken}</td>
        <td style="text-align:center">${slot.not_marked}</td>
        <td style="text-align:center">${skipped}</td>
        <td style="text-align:center;color:${getAdherenceColor(slot.adherence_rate)};font-weight:600">${slot.adherence_rate}%</td>
      </tr>`;
      }
    )
    .join('');

  // As-needed (PRN) medications: a PLAIN RECORD of what was given, after every
  // scheduled-adherence section and never part of any ratio, count or sentence
  // above. Omitted entirely when the backend sent null or nothing was logged.
  // Dates/times are the recipient's wall clock (a real instant resolved in their
  // zone) — never the exporter's.
  const asNeededMeds: PdfAsNeededMedication[] = (report.as_needed?.medications ?? []).filter(
    (m) => m.doses_given > 0 || (m.doses?.length ?? 0) > 0
  );
  const asNeededSection = asNeededMeds.length > 0 ? `
  <div class="section">
    ${asNeededMeds.map((m, index) => {
      const label = m.medication_dosage ? `${m.medication_name} (${m.medication_dosage})` : m.medication_name;
      const rows = (m.doses ?? []).map((d) => {
        const at = new Date(d.given_at);
        const day = env.getDateInTimezone(careRecipientTimezone, at);
        return `
        <tr>
          <td>${escapeHtml(formatDateForPdf(day, locale))}</td>
          <td>${escapeHtml(env.formatInstantTimeOfDay(at, careRecipientTimezone))}</td>
          <td>${escapeHtml(d.given_by_name ?? '')}</td>
          <td>${escapeHtml(d.note ?? '')}</td>
        </tr>`;
      }).join('');
      // The section heading rides in the FIRST medication's block, and each
      // medication's own heading in its block, so neither is left alone at the
      // foot of a page (see keepWithHeading).
      return `
    <div class="${keepWithHeading(m.doses?.length ?? 0).trim()}">
    ${index === 0 ? `<div class="section-title">${t('medicationHistory.export.asNeededSection')}</div>` : ''}
    <div class="subsection-title">${t('medicationHistory.export.asNeededGiven', { name: escapeHtml(label), count: m.doses_given })}</div>
    <table role="table" aria-label="${escapeHtml(label)}">
      <caption class="visually-hidden">${escapeHtml(label)}</caption>
      <thead>
        <tr>
          <th scope="col">${t('medicationHistory.export.date')}</th>
          <th scope="col">${t('medicationHistory.export.time')}</th>
          <th scope="col">${t('medicationHistory.export.asNeededGivenBy')}</th>
          <th scope="col">${t('medicationHistory.export.asNeededNote')}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    </div>`;
    }).join('')}
  </div>
  ` : '';

  const takenOnTime = summary.taken - summary.taken_late;
  const tileLabels = {
    adherenceRate: t('medicationHistory.export.adherenceRate'),
    takenOnTime: t('medicationHistory.export.takenOnTime'),
    takenLate: t('medicationHistory.export.takenLate'),
    notMarked: t('medicationHistory.export.notMarked'),
    skipped: t('medicationHistory.export.skipped'),
    total: t('medicationHistory.export.total'),
  };
  const tileLabelPx = summaryTileLabelFontPx(Object.values(tileLabels));

  return `<!DOCTYPE html>
<html lang="${langCode}">
<head>
  <meta charset="utf-8" />
  <style>
    ${env.sharedStyles ?? getSharedPdfStyles()}
    .meta { text-align: right; color: ${CC.inkSoft}; font-size: 11px; }
    .meta strong { color: ${CC.inkSoft}; }
    .meta .brand-row { justify-content: flex-end; margin-bottom: 6px; }
    .meta .brand { font-size: 14px; }
    .patient-block { flex: 1; }
    .patient-name { font-size: 20px; font-weight: 700; color: ${CC.ink}; }
    .patient-dob { font-size: 12px; color: ${CC.inkSoft}; margin-top: 2px; }
    .report-title { font-size: 12px; color: ${CC.inkSoft}; margin-top: 4px; }
    .summary-sentence { font-size: 13px; color: ${CC.ink}; margin: 6px 0 14px; }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: ${CC.ink};
      margin-bottom: 10px;
      padding-bottom: 6px;
      padding-left: 10px;
      border-left: 3px solid ${CC.moss};
    }
    .day-strip { display: flex; flex-wrap: wrap; gap: 8px 24px; margin-bottom: 8px; }
    .month-group { page-break-inside: avoid; }
    .month-label {
      font-size: 10px;
      font-weight: 600;
      color: ${CC.inkSoft};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .day-cells { display: flex; flex-wrap: wrap; gap: 4px; max-width: 216px; }
    .day-cell {
      width: 18px;
      height: 18px;
      border-radius: 3px;
      font-size: 8px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    /* SIX TILES, ONE ROW, ALWAYS. flex-wrap with a 100px min-width pushed the
       last tile ("Total") onto a row of its own at the iOS print width. A fixed
       six-column grid with shrinkable columns cannot wrap. */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 8px;
    }
    .summary-box {
      min-width: 0;
      background: ${CC.paper};
      border-radius: 8px;
      padding: 12px 3px;
      text-align: center;
    }
    .summary-box .value { font-size: 24px; font-weight: 700; }
    /* Font size is set per document by summaryTileLabelFontPx so the longest
       word fits the tile at the iOS print width. Wrap BETWEEN words only: a
       label must never split inside a word ("ADHERENCI / A"). */
    .summary-box .label {
      font-size: ${tileLabelPx}px;
      line-height: 1.25;
      color: ${CC.inkSoft};
      overflow-wrap: normal;
      word-break: normal;
      hyphens: manual;
      -webkit-hyphens: manual;
    }
    .adherence-highlight {
      background: ${CC.mossWash};
      border: 1px solid ${CC.mossLine};
    }
    .trend-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <header class="header-bar">
    <div class="patient-block">
      <div class="patient-name">${escapeHtml(careRecipientName)}</div>
      ${dobAgeLine ? `<div class="patient-dob">${escapeHtml(dobAgeLine)}</div>` : ''}
      <div class="report-title">${reportTitleHtml}</div>
      ${showCircleName ? `<div style="color:${CC.inkSoft};font-size:11px;margin-top:2px">${escapeHtml(circleName)}</div>` : ''}
    </div>
    <div class="meta">
      <div class="brand-row">${env.logoImg}<span class="brand">CircleCare</span></div>
      <div>${t('medicationHistory.export.preparedOn', { date: preparedOnDate, zone: tzLabel })}</div>
      ${preparedBy ? `<div>${t('medicationHistory.export.preparedBy', { name: escapeHtml(preparedBy) })}</div>` : ''}
    </div>
  </header>

  <main>
  <!-- Summary -->
  <div class="section keep-together">
    <div class="section-title">${t('medicationHistory.export.summaryTitle')}</div>
    <div class="summary-sentence">${t('medicationHistory.export.summarySentence', {
      name: escapeHtml(careRecipientName),
      taken: summary.taken,
      total: summary.total_scheduled,
      rate: summary.adherence_rate,
      late: summary.taken_late,
      notMarked: summary.not_marked,
    })}</div>
    <div class="summary-grid">
      <div class="summary-box adherence-highlight">
        <div class="value" style="color:${adherenceColor}">${summary.adherence_rate}%</div>
        <div class="label">${tileLabels.adherenceRate}</div>
      </div>
      <div class="summary-box">
        <div class="value">${takenOnTime}</div>
        <div class="label">${tileLabels.takenOnTime}</div>
      </div>
      <div class="summary-box">
        <div class="value">${summary.taken_late}</div>
        <div class="label">${tileLabels.takenLate}</div>
      </div>
      <div class="summary-box">
        <div class="value">${summary.not_marked}</div>
        <div class="label">${tileLabels.notMarked}</div>
      </div>
      <div class="summary-box">
        <div class="value">${summary.skipped}</div>
        <div class="label">${tileLabels.skipped}</div>
      </div>
      <div class="summary-box">
        <div class="value">${summary.total_scheduled}</div>
        <div class="label">${tileLabels.total}</div>
      </div>
    </div>
    <!-- The badge alone ("↔ &hellip; (0%)") is a riddle to anyone who did not
         build it — SAY what the delta compares. (Keep trend words out of this
         comment: it ships even when the badge is hidden, and a test asserts
         the hidden document carries no trend wording.) -->
    ${showTrend ? `<div style="margin-top:8px">
      <span class="trend-badge" style="color:${trendColor};background:${trendColor}15">
        ${trendArrow} ${trendLabel} (${summary.trend_change > 0 ? '+' : ''}${summary.trend_change}%)
      </span>
      <span class="legend" style="margin-left:8px">${t('medicationHistory.export.trendLegend')}</span>
    </div>` : ''}
    <!-- Defines "not marked" where the term first appears, not in a footer
         two pages later. -->
    <div class="legend" style="margin-top:10px">${t('medicationHistory.export.notMarkedLegend')}</div>
  </div>

  <!-- By Medication -->
  ${mergedByMedication.length > 0 ? `
  <div class="section${keepWithHeading(mergedByMedication.length)}">
    <div class="section-title">${t('medicationHistory.export.byMedication')}</div>
    <table role="table" aria-label="${t('medicationHistory.export.byMedication')}">
      <caption class="visually-hidden">${t('medicationHistory.export.byMedication')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('medicationHistory.export.medication')}</th>
          <th scope="col">${t('medicationHistory.export.dosage')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.taken')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.notMarked')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.skipped')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.rate')}</th>
        </tr>
      </thead>
      <tbody>${medRows}</tbody>
    </table>
  </div>
  ` : ''}

  <!-- Daily Breakdown -->
  ${recentDaily.length > 0 ? `
  <div class="section">
    <!-- Heading + strip + both legend lines are ONE unit: an iOS export split
         the colour key onto the next page, away from the squares it explains,
         and iOS WebKit ignores break-after on the heading, which left the
         heading alone at the foot of page 1. -->
    <div class="keep-together">
    <div class="section-title">${t('medicationHistory.export.dailyBreakdown')}</div>
    <div class="day-strip" aria-label="${t('medicationHistory.export.dailyBreakdown')}">${dayStrip}</div>
    <div class="legend">${t('medicationHistory.export.dailyLegend')}</div>
    ${dayLegend}
    </div>
    <!-- A short exceptions list stays on one page with its title instead of
         leaving a lone row at the foot of a page; a long one is allowed to
         flow (the header row repeats). -->
    <div class="${exceptionDays.length <= 10 ? 'keep-together' : ''}">
    <div class="section-title" style="font-size:13px;margin-top:16px">${t('medicationHistory.export.daysBelowFull')}</div>
    ${exceptionDays.length > 0 ? `
    <table role="table" aria-label="${t('medicationHistory.export.daysBelowFull')}">
      <caption class="visually-hidden">${t('medicationHistory.export.daysBelowFull')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('medicationHistory.export.date')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.scheduled')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.taken')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.notMarked')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.skipped')}</th>
        </tr>
      </thead>
      <tbody>${exceptionRows}</tbody>
    </table>
    ` : `<div>${t('medicationHistory.export.noExceptions')}</div>`}
    </div>
  </div>
  ` : ''}

  <!-- Time Breakdown -->
  ${time_breakdown.length > 0 ? `
  <div class="section${keepWithHeading(time_breakdown.length)}">
    <div class="section-title">${t('medicationHistory.export.timeBreakdown')}</div>
    <table role="table" aria-label="${t('medicationHistory.export.timeBreakdown')}">
      <caption class="visually-hidden">${t('medicationHistory.export.timeBreakdown')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('medicationHistory.export.time')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.total')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.taken')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.notMarked')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.skipped')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.rate')}</th>
        </tr>
      </thead>
      <tbody>${timeRows}</tbody>
    </table>
  </div>
  ` : ''}

  <!-- As-needed medications (not part of the adherence rate) -->
  ${asNeededSection}

  <!-- Health Vitals -->
  ${vitalsData && vitalsData.length > 0 ? `
  <div class="section${keepWithHeading(vitalsData.length)}">
    <div class="section-title">${t('medicationHistory.export.healthVitals')}</div>
    <table role="table" aria-label="${t('medicationHistory.export.healthVitals')}">
      <caption class="visually-hidden">${t('medicationHistory.export.healthVitals')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('medicationHistory.export.vitalType')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.vitalLatest')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.vitalAverage')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.vitalMin')}</th>
          <th scope="col" style="text-align:center">${t('medicationHistory.export.vitalMax')}</th>
        </tr>
      </thead>
      <tbody>${vitalsData.map(v => `
        <tr>
          <td>${escapeHtml(v.type)}</td>
          <td style="text-align:center">${v.latest.value2 != null ? `${v.latest.value1}/${v.latest.value2}` : `${v.latest.value1}`}${vitalUnitSuffix(v.latest.unit)}</td>
          <td style="text-align:center">${v.average2 != null ? `${v.average}/${v.average2}` : `${v.average}`}${vitalUnitSuffix(v.latest.unit)}</td>
          <td style="text-align:center">${v.minReading && v.minReading.value2 != null ? `${v.minReading.value1}/${v.minReading.value2}` : `${v.minReading ? v.minReading.value1 : v.min}`}${vitalUnitSuffix(v.latest.unit)}</td>
          <td style="text-align:center">${v.maxReading && v.maxReading.value2 != null ? `${v.maxReading.value1}/${v.maxReading.value2}` : `${v.maxReading ? v.maxReading.value1 : v.max}`}${vitalUnitSuffix(v.latest.unit)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}
  </main>

  <footer class="footer">
    <div class="confidential">${t('medicationHistory.export.confidential')}</div>
    <div>${t('medicationHistory.export.generatedBy')} &middot; ${formatTimestamp(careRecipientTimezone, env)}</div>
  </footer>
</body>
</html>`;
}
