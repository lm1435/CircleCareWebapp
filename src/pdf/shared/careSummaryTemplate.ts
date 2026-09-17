/**
 * SHARED SOURCE — canonical copy. Mirrored byte-for-byte to webapp/src/pdf/shared/
 * by mobile/scripts/sync-pdf-shared.sh; a webapp test fails on drift. Platform-pure: no
 * imports outside this folder except `import type`. Edit HERE, then run the sync
 * script.
 */
import type { PdfEnv } from './env';
import type { PdfCalendarEvent, PdfEmergencyInfo } from './types';
import { PDF_PALETTE as CC } from './palette';
import {
  getSharedPdfStyles,
  displayValue,
  computeAge,
  escapeHtml,
  PLACEHOLDER_DISPLAY,
} from './pdfBranding';

/**
 * What the care summary prints. `t` and `locale` are NOT here — they arrive on
 * the {@link PdfEnv} with every other platform concern, so this shape is the
 * same object on mobile and web.
 */
export interface CareSummaryTemplateOptions {
  recipientName: string;
  recipientDob: string | null;
  recipientConditions: string[] | null;
  emergencyInfo: PdfEmergencyInfo | null | undefined;
  medications: PdfCalendarEvent[];
  careRecipientTimezone: string;
  /** Display name of the person who generated the export, for the header's
   *  "Prepared by" line. Omitted (not printed) when unavailable. */
  preparedBy?: string;
}

/** One row of the medications table/list: every scheduled event sharing a
 *  name + dosage, merged so "Metformin 500mg" prints once instead of once
 *  per scheduled time. */
interface MedicationGroup {
  name: string;
  /** Raw dosage — placeholder handling happens at render time via `displayValue`. */
  dosage: string | null;
  /** Raw `HH:MM` scheduled times, recipient zone, insertion order, deduped. */
  times: string[];
  /** One event per DISTINCT raw recurrence rule across the group, insertion
   *  order — formatted (and deduped again on their TEXT) at render time, since
   *  two different raw rules can format to the same label. The whole event is
   *  kept, not just the rule, because `env.formatRecurrence` may also read
   *  `recurrence_days`. */
  recurrenceSources: PdfCalendarEvent[];
  /** The first event in this group, in `medications` order — the stopped
   *  label is computed from this one event, per the spec. */
  firstEvent: PdfCalendarEvent;
  /** True when this group is a discontinued series. Stopped medications print
   *  in their own table below the current ones, never mixed in. */
  stopped: boolean;
}

/**
 * Group medications by name + dosage: same name at the same dose, scheduled
 * at several times a day, is ONE row — a caregiver reads "Metformin 500mg"
 * once with every time listed, not the same medication three times over.
 * Same name at a DIFFERENT dose stays a separate row, and so does the same
 * dose after it was STOPPED — a re-added medication must not fold into the
 * stopped row (or vice versa) and lose its status.
 */
function groupMedications(medications: PdfCalendarEvent[]): MedicationGroup[] {
  const order: string[] = [];
  const groups = new Map<string, MedicationGroup>();

  for (const m of medications) {
    const name = m.medication_name || m.title;
    const dosage = m.medication_dosage || null;
    const stopped = Boolean(m.discontinued_at);
    const key = `${stopped ? 'stopped' : 'active'} ${name} ${dosage ?? ''}`;

    let group = groups.get(key);
    if (!group) {
      group = { name, dosage, times: [], recurrenceSources: [], firstEvent: m, stopped };
      groups.set(key, group);
      order.push(key);
    }
    if (m.scheduled_time && !group.times.includes(m.scheduled_time)) {
      group.times.push(m.scheduled_time);
    }
    if (
      m.recurrence_rule &&
      !group.recurrenceSources.some((e) => e.recurrence_rule === m.recurrence_rule)
    ) {
      group.recurrenceSources.push(m);
    }
  }

  return order.map((key) => groups.get(key)!);
}

/** The group's Time column: every scheduled time, recipient zone, joined. */
function formatGroupTimes(
  group: MedicationGroup,
  careRecipientTimezone: string,
  env: PdfEnv,
): string {
  return group.times.map((time) => formatTime(time, careRecipientTimezone, env)).join(', ');
}

/**
 * The group's Frequency column: the formatted recurrence, once — or, when the
 * group's underlying rules genuinely differ (a medication re-scheduled mid
 * series, say), every distinct formatted label joined by "; ". Dedupes on the
 * FORMATTED text, not the raw rule, since `daily` and `FREQ=DAILY` are two
 * different raw strings for the same one label.
 */
function formatGroupFrequency(group: MedicationGroup, env: PdfEnv): string {
  const labels = group.recurrenceSources
    .map((event) => env.formatRecurrence(event))
    .filter((label): label is string => Boolean(label));
  if (labels.length === 0) {
    // No rule at all = a one-time dose. An empty cell here read as "unknown";
    // it is a real answer, and the day it was given is the useful half of it.
    return env.t('careSummary.frequency.oneTime', {
      date: formatDateForPdf(group.firstEvent.scheduled_date, env.locale),
    });
  }
  return Array.from(new Set(labels)).join('; ');
}

/**
 * Format a YYYY-MM-DD date string for display.
 * Uses T12:00:00Z + timeZone: 'UTC' to avoid timezone date-shift.
 */
function formatDateForPdf(dateStr: string, locale: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * "Stopped <date>" for a discontinued medication, or '' when it is still active.
 *
 * `discontinued_at` is a real UTC instant, not a naive care date, so it is
 * resolved to a calendar day in the CARE RECIPIENT's timezone before being
 * formatted — a late-evening stop must not print as the next day.
 */
function formatStoppedLabel(
  m: PdfCalendarEvent,
  careRecipientTimezone: string,
  env: PdfEnv
): string {
  if (!m.discontinued_at) return '';
  return env.t('careSummary.fields.stopped', {
    date: formatStoppedDate(m, careRecipientTimezone, env),
  });
}

/** The bare stop date (no "Stopped" prefix) for a column already titled
 *  "Stopped". Same recipient-zone day resolution as {@link formatStoppedLabel}. */
function formatStoppedDate(m: PdfCalendarEvent, careRecipientTimezone: string, env: PdfEnv): string {
  if (!m.discontinued_at) return '';
  const day = env.getDateInTimezone(careRecipientTimezone, new Date(m.discontinued_at));
  return formatDateForPdf(day, env.locale);
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
 * SPLIT IN TWO ON PURPOSE — see the twin in `adherenceReportTemplate.ts`. The
 * date half is Intl's job (month names are language); the time half must not
 * be, because `toLocaleString(locale, …)` reads 12h/24h off the LOCALE and
 * ignores the device clock toggle that every other time in the app honours.
 */
function formatTimestamp(timezone: string, env: PdfEnv): string {
  const now = new Date();
  const dateStr = formatDateOnly(now, timezone, env.locale);
  // NAME THE ZONE UNCONDITIONALLY, unlike every screen in the app.
  //
  // The per-time suffix suppresses itself when the reader shares the recipient's
  // zone, which is right on a screen — the reader is the person holding the
  // phone. A PDF is not: it is shared off-device (`Sharing.shareAsync`) and read
  // by a clinician whose zone we cannot know. Suppressing the label there left
  // this document stating bare wall-clock medication times with nothing to
  // anchor them, because the EXPORTER happened to share the recipient's zone.
  //
  // `adherenceReportTemplate` states it in its header for exactly this reason;
  // this file is its twin and had no such statement anywhere. Named from the
  // export's own locale, not the ambient i18next language, matching the rest
  // of this file.
  const langCode = env.locale.split('-')[0];
  const zone = env.getTimezoneLabel(timezone, langCode === 'es' ? 'es' : 'en');
  const stamp = `${dateStr}, ${env.formatInstantTimeOfDay(now, timezone)}`;
  return zone ? `${stamp} (${zone})` : stamp;
}

/**
 * A medication's naive `HH:MM`, already in the recipient's zone, rendered in
 * that ONE zone — no second clock appended.
 *
 * This used to route through the app's dual-zone renderer, which prints BOTH
 * clocks for a viewer whose device zone differs from the recipient's ("8:00
 * AM (Denver) / 10:00 AM (New York)"). A shared document has no "viewer" to
 * render a second clock for — it is read off-device, later, by anyone — and
 * the header already states whose clock the sheet is on, so the second half
 * was noise repeated on every row.
 */
function formatTime(timeStr: string | null | undefined, timezone: string, env: PdfEnv): string {
  if (!timeStr) return '';
  const [hoursStr, minutesStr] = timeStr.split(':');
  const hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  if (isNaN(hours) || isNaN(minutes)) return timeStr;
  return env.formatTimeOfDay(hours, minutes, timezone);
}

export function renderCareSummaryHtml(options: CareSummaryTemplateOptions, env: PdfEnv): string {
  // A section with at most this many rows is kept on one page with its title and
  // column headers; longer ones flow (rows and the repeated header protect themselves).
  const keepShort = (rows: number): string => (rows <= 10 ? 'keep-together' : '');
  const { recipientName, recipientDob, recipientConditions, emergencyInfo, medications, careRecipientTimezone, preparedBy } = options;
  const { t, locale } = env;

  const langCode = locale.split('-')[0];
  const tzLabel = env.getTimezoneLabel(careRecipientTimezone, langCode === 'es' ? 'es' : 'en');
  const dobFormatted = recipientDob ? formatDateForPdf(recipientDob, locale) : null;
  const age = recipientDob ? computeAge(recipientDob, careRecipientTimezone, env) : null;
  const dobAgeLine = dobFormatted && age != null
    ? t('careSummary.pdf.dobAge', { dob: dobFormatted, age })
    : null;
  const preparedOnDate = formatDateOnly(new Date(), careRecipientTimezone, locale);

  // Medications rows — one per name+dosage group, every scheduled time listed
  // together rather than one row per time (see `groupMedications`). Current
  // and stopped medications are two tables: a table titled "Current
  // medications" must not carry rows that are not current.
  const medGroups = groupMedications(medications);
  const activeGroups = medGroups.filter((g) => !g.stopped);
  const stoppedGroups = medGroups.filter((g) => g.stopped);
  const medRows = activeGroups
    .map((group) => `
      <tr>
        <td>${escapeHtml(group.name)}</td>
        <td>${escapeHtml(displayValue(group.dosage))}</td>
        <td>${escapeHtml(formatGroupTimes(group, careRecipientTimezone, env))}</td>
        <td>${escapeHtml(formatGroupFrequency(group, env))}</td>
      </tr>`)
    .join('');
  const stoppedRows = stoppedGroups
    .map((group) => `
      <tr class="muted">
        <td>${escapeHtml(group.name)}</td>
        <td>${escapeHtml(displayValue(group.dosage))}</td>
        <td>${escapeHtml(formatGroupFrequency(group, env))}</td>
        <td>${escapeHtml(formatStoppedDate(group.firstEvent, careRecipientTimezone, env))}</td>
      </tr>`)
    .join('');
  const stoppedTable = stoppedGroups.length > 0
    ? `
    <div class="subsection-title">${escapeHtml(t('careSummary.sections.stoppedMedications'))}</div>
    <table role="table" aria-label="${t('careSummary.sections.stoppedMedications')}">
      <caption class="visually-hidden">${t('careSummary.sections.stoppedMedications')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('careSummary.fields.medication')}</th>
          <th scope="col">${t('careSummary.fields.dosage')}</th>
          <th scope="col">${t('careSummary.fields.frequency')}</th>
          <th scope="col">${t('careSummary.fields.stoppedOn')}</th>
        </tr>
      </thead>
      <tbody>${stoppedRows}</tbody>
    </table>`
    : '';

  // Doctors rows
  const doctors: { name: string; specialty?: string | null; phone?: string | null; isPrimary?: boolean }[] = [];
  if (emergencyInfo?.primary_doctor_name) {
    doctors.push({
      name: emergencyInfo.primary_doctor_name,
      specialty: emergencyInfo.primary_doctor_specialty,
      phone: emergencyInfo.primary_doctor_phone,
      isPrimary: true,
    });
  }
  (emergencyInfo?.additional_doctors || []).forEach(d => {
    doctors.push({ name: d.name, specialty: d.specialty, phone: d.phone });
  });
  const doctorRows = doctors
    .map(d => `
      <tr>
        <td>${escapeHtml(d.name)}${d.isPrimary ? ` <span class="badge-primary">(${t('careSummary.pdf.primary')})</span>` : ''}</td>
        <td>${escapeHtml(displayValue(d.specialty))}</td>
        <td>${escapeHtml(displayValue(d.phone))}</td>
      </tr>`)
    .join('');

  // Emergency contacts rows
  const contactRows = (emergencyInfo?.emergency_contacts || [])
    .map(c => `
      <tr>
        <td>${escapeHtml(c.name)}${c.is_primary ? ` <span class="badge-primary">(${t('careSummary.pdf.primary')})</span>` : ''}</td>
        <td>${escapeHtml(c.relationship)}</td>
        <td>${escapeHtml(displayValue(c.phone))}</td>
      </tr>`)
    .join('');

  // Insurance rows. The pharmacy routing numbers (BIN / PCN / Rx group) ride
  // under the carrier as a small second line, only when the card had them —
  // a pharmacist filling a discharge prescription needs exactly those three.
  const insuranceRows = (emergencyInfo?.insurance_plans || [])
    .map(p => {
      const rx = [
        p.rx_bin ? `${t('careSummary.fields.rxBin')} ${escapeHtml(p.rx_bin)}` : '',
        p.rx_pcn ? `${t('careSummary.fields.rxPcn')} ${escapeHtml(p.rx_pcn)}` : '',
        p.rx_group ? `${t('careSummary.fields.rxGroup')} ${escapeHtml(p.rx_group)}` : '',
      ].filter(Boolean).join(' · ');
      return `
      <tr>
        <td>${escapeHtml(p.carrier)}${p.label ? ` <span class="badge-info">(${escapeHtml(p.label)})</span>` : ''}${rx ? `<span class="sub">${rx}</span>` : ''}</td>
        <td class="nowrap">${escapeHtml(displayValue(p.policy_number))}</td>
        <td class="nowrap">${escapeHtml(displayValue(p.group_number))}</td>
        <td class="nowrap">${escapeHtml(displayValue(p.phone))}</td>
      </tr>`;
    })
    .join('');

  // Code status. `has_dnr` is a real, deliberately set flag (EditDirectives);
  // its default-false is NOT evidence of "no DNR", so nothing prints for
  // false. Free-text directives print in full when present.
  const directiveNotes = emergencyInfo?.advance_directives?.trim() || '';
  const codeStatusBlock = emergencyInfo?.has_dnr || directiveNotes
    ? `<div class="directives-box">
        ${emergencyInfo?.has_dnr ? `<div class="directives-row"><span class="directives-label">${escapeHtml(t('careSummary.fields.codeStatus'))}:</span> <strong>${escapeHtml(t('careSummary.fields.dnrOnFile'))}</strong></div>` : ''}
        ${directiveNotes ? `<div class="directives-row"><span class="directives-label">${escapeHtml(t('careSummary.fields.advanceDirectives'))}:</span> ${escapeHtml(directiveNotes)}</div>` : ''}
      </div>`
    : '';

  // Allergy info — lives in the Care recipient section now (see item 8), not
  // beneath the medications table.
  const allergyItems: string[] = [];
  if (emergencyInfo?.medication_allergies?.length) {
    allergyItems.push(`<div class="allergy-row"><span class="allergy-label">${escapeHtml(t('careSummary.fields.medicationAllergies'))}:</span> ${escapeHtml(emergencyInfo.medication_allergies.join(', '))}</div>`);
  }
  if (emergencyInfo?.allergies?.length) {
    allergyItems.push(`<div class="allergy-row"><span class="allergy-label">${escapeHtml(t('careSummary.fields.otherAllergies'))}:</span> ${escapeHtml(emergencyInfo.allergies.join(', '))}</div>`);
  }
  const allergySection = allergyItems.length > 0
    ? `<div class="allergy-box">${allergyItems.join('')}</div>`
    : `<div class="no-allergies">${escapeHtml(t('careSummary.empty.noAllergies'))}</div>`;

  const emptyRow = (msg: string, cols: number) => `<tr><td colspan="${cols}" style="text-align:center;color:${CC.inkMute};padding:12px">${escapeHtml(msg)}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="${langCode}">
<head>
  <meta charset="utf-8" />
  <style>
    ${env.sharedStyles ?? getSharedPdfStyles()}
    .meta { text-align: right; color: ${CC.inkSoft}; font-size: 11px; }
    .meta .brand-row { justify-content: flex-end; margin-bottom: 6px; }
    .meta .brand { font-size: 14px; }
    .patient-block { flex: 1; }
    .patient-name { font-size: 20px; font-weight: 700; color: ${CC.ink}; }
    .patient-dob { font-size: 12px; color: ${CC.inkSoft}; margin-top: 2px; }
    .report-title { font-size: 12px; color: ${CC.inkSoft}; margin-top: 4px; }
    .no-allergies { color: ${CC.inkSoft}; font-size: 12px; margin-top: 8px; }
    h2 {
      font-size: 16px;
      font-weight: 700;
      color: ${CC.ink};
      margin-bottom: 10px;
      padding-bottom: 6px;
      padding-left: 10px;
      border-left: 3px solid ${CC.moss};
    }
    .info-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
    .info-item { flex: 1; min-width: 140px; }
    .info-label { font-size: 11px; color: ${CC.inkSoft}; text-transform: uppercase; letter-spacing: 0.5px; }
    .info-value { font-size: 13px; color: ${CC.ink}; font-weight: 500; }
    .badge-primary { color: ${CC.moss}; font-weight: 600; font-size: 10px; }
    .badge-info { color: ${CC.duskDeep}; font-size: 10px; }
    .allergy-box {
      background: ${CC.terracottaSoft};
      border: 2px solid ${CC.terracotta};
      border-radius: 6px;
      padding: 10px 14px;
      margin-top: 12px;
      page-break-inside: avoid;
    }
    .allergy-row { margin-bottom: 4px; font-size: 12px; color: ${CC.ink}; }
    .allergy-row:last-child { margin-bottom: 0; }
    .allergy-label { font-weight: 700; color: ${CC.terracotta}; }
    .directives-box {
      border: 1px solid ${CC.hairStrong};
      border-left: 3px solid ${CC.terracotta};
      border-radius: 6px;
      padding: 8px 14px;
      margin-top: 10px;
      page-break-inside: avoid;
    }
    .directives-row { font-size: 12px; color: ${CC.ink}; margin-bottom: 4px; }
    .directives-row:last-child { margin-bottom: 0; }
    .directives-label { font-weight: 700; color: ${CC.terracotta}; }
    /* Identifiers and phone numbers must never break mid-number: an iOS export wrapped
       "(800) 633-4227" onto three lines, which also pushed the footer onto a page of
       its own. The carrier column takes the wrapping instead. */
    .nowrap { white-space: nowrap; }
  </style>
</head>
<body>
  <header class="header-bar">
    <div class="patient-block">
      <div class="patient-name">${escapeHtml(recipientName)}</div>
      ${dobAgeLine ? `<div class="patient-dob">${escapeHtml(dobAgeLine)}</div>` : ''}
      <div class="report-title">${escapeHtml(t('careSummary.title'))}</div>
    </div>
    <div class="meta">
      <div class="brand-row">${env.logoImg}<span class="brand">CircleCare</span></div>
      <div>${t('careSummary.pdf.preparedOn', { date: preparedOnDate, zone: tzLabel })}</div>
      ${preparedBy ? `<div>${t('careSummary.pdf.preparedBy', { name: escapeHtml(preparedBy) })}</div>` : ''}
    </div>
  </header>

  <main>
  <!-- 1. Patient Info. Name and DOB are already the header; this block
       carries only what the header does not: conditions, blood type,
       allergies and code status — the facts a first responder scans for. -->
  <section aria-labelledby="section-patient" class="keep-together">
    <h2 id="section-patient">${t('careSummary.sections.careRecipient')}</h2>
    ${recipientConditions?.length || emergencyInfo?.blood_type ? `
    <div class="info-grid">
      ${recipientConditions?.length ? `
      <div class="info-item">
        <div class="info-label">${t('careSummary.fields.conditions')}</div>
        <div class="info-value">${escapeHtml(recipientConditions.join(', '))}</div>
      </div>` : ''}
      ${emergencyInfo?.blood_type ? `
      <div class="info-item">
        <div class="info-label">${t('careSummary.fields.bloodType')}</div>
        <div class="info-value">${escapeHtml(emergencyInfo.blood_type)}</div>
      </div>` : ''}
    </div>` : ''}
    ${allergySection}
    ${codeStatusBlock}
  </section>

  <!-- 2. Emergency Contacts — directly under the patient block so the people
       to call are on page one, next to the allergies and code status. -->
  <section aria-labelledby="section-contacts" class="${keepShort((emergencyInfo?.emergency_contacts || []).length)}">
    <h2 id="section-contacts">${t('careSummary.sections.emergencyContacts')}</h2>
    <table role="table" aria-label="${t('careSummary.sections.emergencyContacts')}">
      <caption class="visually-hidden">${t('careSummary.sections.emergencyContacts')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('careSummary.fields.name')}</th>
          <th scope="col">${t('careSummary.fields.relationship')}</th>
          <th scope="col">${t('careSummary.fields.phone')}</th>
        </tr>
      </thead>
      <tbody>${contactRows || emptyRow(t('careSummary.empty.noContacts'), 3)}</tbody>
    </table>
  </section>

  <!-- 3. Medications -->
  <section aria-labelledby="section-meds" class="${keepShort(activeGroups.length + stoppedGroups.length)}">
    <h2 id="section-meds">${t('careSummary.sections.medications')}</h2>
    <table role="table" aria-label="${t('careSummary.sections.medications')}">
      <caption class="visually-hidden">${t('careSummary.sections.medications')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('careSummary.fields.medication')}</th>
          <th scope="col">${t('careSummary.fields.dosage')}</th>
          <th scope="col">${t('careSummary.fields.time')}</th>
          <th scope="col">${t('careSummary.fields.frequency')}</th>
        </tr>
      </thead>
      <tbody>${medRows || emptyRow(t('careSummary.empty.noMedications'), 4)}</tbody>
    </table>
    ${stoppedTable}
  </section>

  <!-- 4. Healthcare Providers -->
  <section aria-labelledby="section-doctors" class="${keepShort(doctors.length)}">
    <h2 id="section-doctors">${t('careSummary.sections.healthcareProviders')}</h2>
    <table role="table" aria-label="${t('careSummary.sections.healthcareProviders')}">
      <caption class="visually-hidden">${t('careSummary.sections.healthcareProviders')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('careSummary.fields.name')}</th>
          <th scope="col">${t('careSummary.fields.specialty')}</th>
          <th scope="col">${t('careSummary.fields.phone')}</th>
        </tr>
      </thead>
      <tbody>${doctorRows || emptyRow(t('careSummary.empty.noDoctors'), 3)}</tbody>
    </table>
  </section>

  <!-- 5. Insurance -->
  <section aria-labelledby="section-insurance" class="${keepShort((emergencyInfo?.insurance_plans || []).length)}">
    <h2 id="section-insurance">${t('careSummary.sections.insurance')}</h2>
    <table role="table" aria-label="${t('careSummary.sections.insurance')}">
      <caption class="visually-hidden">${t('careSummary.sections.insurance')}</caption>
      <thead>
        <tr>
          <th scope="col">${t('careSummary.fields.carrier')}</th>
          <th scope="col" class="nowrap">${t('careSummary.fields.policyNumber')}</th>
          <th scope="col" class="nowrap">${t('careSummary.fields.groupNumber')}</th>
          <th scope="col" class="nowrap">${t('careSummary.fields.phone')}</th>
        </tr>
      </thead>
      <tbody>${insuranceRows || emptyRow(t('careSummary.empty.noInsurance'), 4)}</tbody>
    </table>
  </section>
  </main>

  <footer class="footer">
    <div class="confidential">${t('careSummary.pdf.confidentiality')}</div>
    <div>${t('careSummary.pdf.generatedBy')} &middot; ${formatTimestamp(careRecipientTimezone, env)}</div>
  </footer>
</body>
</html>`;
}

export function renderCareSummaryText(options: CareSummaryTemplateOptions, env: PdfEnv): string {
  const { recipientName, recipientDob, recipientConditions, emergencyInfo, medications, careRecipientTimezone } = options;
  const { t, locale } = env;

  const lines: string[] = [];
  const divider = '─'.repeat(40);

  // Header
  lines.push(`${t('careSummary.title').toUpperCase()}`);
  lines.push(divider);

  // 1. Patient Info
  lines.push(`\n${t('careSummary.sections.careRecipient')}`);
  lines.push(`${t('careSummary.fields.name')}: ${recipientName}`);
  if (recipientDob) {
    lines.push(`${t('careSummary.fields.dateOfBirth')}: ${formatDateForPdf(recipientDob, locale)}`);
  }
  if (recipientConditions?.length) {
    lines.push(`${t('careSummary.fields.conditions')}: ${recipientConditions.join(', ')}`);
  }
  if (emergencyInfo?.blood_type) {
    lines.push(`${t('careSummary.fields.bloodType')}: ${emergencyInfo.blood_type}`);
  }
  // Allergies, moved ahead of the medications list (see item 8) so a
  // caregiver reads them alongside the rest of the patient's own info,
  // before any medication.
  if (emergencyInfo?.medication_allergies?.length) {
    lines.push(`${t('careSummary.fields.medicationAllergies')}: ${emergencyInfo.medication_allergies.join(', ')}`);
  }
  if (emergencyInfo?.allergies?.length) {
    lines.push(`${t('careSummary.fields.otherAllergies')}: ${emergencyInfo.allergies.join(', ')}`);
  }
  if (!emergencyInfo?.medication_allergies?.length && !emergencyInfo?.allergies?.length) {
    lines.push(t('careSummary.empty.noAllergies'));
  }
  if (emergencyInfo?.has_dnr) {
    lines.push(`${t('careSummary.fields.codeStatus')}: ${t('careSummary.fields.dnrOnFile')}`);
  }
  if (emergencyInfo?.advance_directives?.trim()) {
    lines.push(`${t('careSummary.fields.advanceDirectives')}: ${emergencyInfo.advance_directives.trim()}`);
  }

  // 2. Emergency Contacts — same position as the PDF: right after the
  // patient's own facts.
  lines.push(`\n${t('careSummary.sections.emergencyContacts')}`);
  lines.push(divider);
  if (emergencyInfo?.emergency_contacts?.length) {
    emergencyInfo.emergency_contacts.forEach(c => {
      const primary = c.is_primary ? ` (${t('careSummary.pdf.primary')})` : '';
      lines.push(`${c.name}${primary} — ${c.relationship} — ${displayValue(c.phone)}`);
    });
  } else {
    lines.push(t('careSummary.empty.noContacts'));
  }

  // 3. Medications — one line per name+dosage group, all its scheduled times
  // together (see `groupMedications`), not one line per scheduled time.
  // Stopped medications follow under their own heading.
  lines.push(`\n${t('careSummary.sections.medications')}`);
  lines.push(divider);
  const medGroups = groupMedications(medications);
  const activeGroups = medGroups.filter((g) => !g.stopped);
  const stoppedGroups = medGroups.filter((g) => g.stopped);
  if (activeGroups.length > 0) {
    activeGroups.forEach((group) => {
      const dosage = displayValue(group.dosage);
      const time = formatGroupTimes(group, careRecipientTimezone, env);
      const freq = formatGroupFrequency(group, env);
      lines.push(
        `${group.name}${dosage !== PLACEHOLDER_DISPLAY ? ` (${dosage})` : ''} — ${time}${freq ? ` — ${freq}` : ''}`
      );
    });
  } else {
    lines.push(t('careSummary.empty.noMedications'));
  }
  if (stoppedGroups.length > 0) {
    lines.push(`\n${t('careSummary.sections.stoppedMedications')}`);
    lines.push(divider);
    stoppedGroups.forEach((group) => {
      const dosage = displayValue(group.dosage);
      const freq = formatGroupFrequency(group, env);
      const stopped = formatStoppedLabel(group.firstEvent, careRecipientTimezone, env);
      lines.push(
        `${group.name}${dosage !== PLACEHOLDER_DISPLAY ? ` (${dosage})` : ''}${freq ? ` — ${freq}` : ''} — ${stopped}`
      );
    });
  }

  // 4. Healthcare Providers
  lines.push(`\n${t('careSummary.sections.healthcareProviders')}`);
  lines.push(divider);
  const hasDoctors = emergencyInfo?.primary_doctor_name || (emergencyInfo?.additional_doctors?.length ?? 0) > 0;
  if (hasDoctors) {
    if (emergencyInfo?.primary_doctor_name) {
      const primary = `(${t('careSummary.pdf.primary')})`;
      const specialty = displayValue(emergencyInfo.primary_doctor_specialty);
      const phone = displayValue(emergencyInfo.primary_doctor_phone);
      lines.push(`${emergencyInfo.primary_doctor_name} ${primary}${specialty !== PLACEHOLDER_DISPLAY ? ` — ${specialty}` : ''}${phone !== PLACEHOLDER_DISPLAY ? ` — ${phone}` : ''}`);
    }
    emergencyInfo?.additional_doctors?.forEach(d => {
      const specialty = displayValue(d.specialty);
      const phone = displayValue(d.phone);
      lines.push(`${d.name}${specialty !== PLACEHOLDER_DISPLAY ? ` — ${specialty}` : ''}${phone !== PLACEHOLDER_DISPLAY ? ` — ${phone}` : ''}`);
    });
  } else {
    lines.push(t('careSummary.empty.noDoctors'));
  }

  // 5. Insurance
  lines.push(`\n${t('careSummary.sections.insurance')}`);
  lines.push(divider);
  if (emergencyInfo?.insurance_plans?.length) {
    emergencyInfo.insurance_plans.forEach(p => {
      lines.push(`${p.carrier}${p.label ? ` (${p.label})` : ''}`);
      const policyNumber = displayValue(p.policy_number);
      const groupNumber = displayValue(p.group_number);
      const phone = displayValue(p.phone);
      if (policyNumber !== PLACEHOLDER_DISPLAY) lines.push(`  ${t('careSummary.fields.policyNumber')}: ${policyNumber}`);
      if (groupNumber !== PLACEHOLDER_DISPLAY) lines.push(`  ${t('careSummary.fields.groupNumber')}: ${groupNumber}`);
      if (phone !== PLACEHOLDER_DISPLAY) lines.push(`  ${t('careSummary.fields.phone')}: ${phone}`);
      if (p.rx_bin) lines.push(`  ${t('careSummary.fields.rxBin')}: ${p.rx_bin}`);
      if (p.rx_pcn) lines.push(`  ${t('careSummary.fields.rxPcn')}: ${p.rx_pcn}`);
      if (p.rx_group) lines.push(`  ${t('careSummary.fields.rxGroup')}: ${p.rx_group}`);
    });
  } else {
    lines.push(t('careSummary.empty.noInsurance'));
  }

  // Footer
  lines.push(`\n${divider}`);
  lines.push(t('careSummary.pdf.confidentiality'));
  lines.push(`${t('careSummary.pdf.generatedBy')} — ${formatTimestamp(careRecipientTimezone, env)}`);

  return lines.join('\n');
}
