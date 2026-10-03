/**
 * Smoke tests for the two web adapters: real i18n, real env, real templates —
 * the rendered documents carry the recipient's name, the translated section
 * titles and the confidentiality line. Layout details are covered by the
 * mobile template suites; this only proves the web wiring end to end.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { queryClient } from '@/lib/queryClient';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { AdherenceReport } from '@/api/medicationConfirmations';
import {
  careSummaryFileTitle,
  generateCareSummaryHtml,
  generateCareSummaryText,
} from '../careSummaryPdf';
import { adherenceReportFileTitle, generateAdherenceReportHtml } from '../adherenceReportPdf';

const DENVER = 'America/Denver';

const emergencyInfo: EmergencyInfo = {
  id: 'ei1',
  circle_id: 'c1',
  insurance_plans: [{ carrier: 'Blue Shield', policy_number: 'P-1', group_number: null }],
  primary_doctor_name: 'Dr. Grace Hopper',
  primary_doctor_specialty: 'Cardiology',
  primary_doctor_phone: '555-0100',
  additional_doctors: null,
  allergies: ['Peanuts'],
  medication_allergies: ['Penicillin'],
  medical_conditions: ['Hypertension'],
  blood_type: 'O+',
  emergency_contacts: [
    { name: 'Charles Babbage', relationship: 'Friend', phone: '555-0199', is_primary: true },
  ],
  advance_directives: null,
  has_dnr: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const medication: CalendarEvent = {
  id: 'e1',
  circle_id: 'c1',
  event_type: 'medication',
  title: 'Metformin',
  medication_name: 'Metformin',
  medication_dosage: '500mg',
  scheduled_date: '2025-06-10',
  scheduled_time: '08:00:00',
  recurrence_rule: 'daily',
  discontinued_at: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

const report: AdherenceReport = {
  period_days: 30,
  start_date: '2025-05-16',
  end_date: '2025-06-14',
  summary: {
    total_scheduled: 60,
    taken: 54,
    taken_late: 3,
    not_marked: 4,
    skipped: 2,
    adherence_rate: 90,
    trend: 'stable',
    trend_change: 0,
  },
  daily_breakdown: [
    { date: '2025-06-13', taken: 2, not_marked: 0, skipped: 0, total: 2, adherence_rate: 100 },
    { date: '2025-06-14', taken: 1, not_marked: 1, skipped: 0, total: 2, adherence_rate: 50 },
  ],
  by_medication: [
    {
      id: 'm1',
      name: 'Metformin',
      dosage: '500mg',
      taken: 54,
      not_marked: 4,
      skipped: 2,
      total: 60,
      adherence_rate: 90,
    },
  ],
  time_breakdown: [{ time: '08:00', taken: 27, not_marked: 2, total: 30, adherence_rate: 90 }],
};

beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
  queryClient.clear();
});

describe('generateCareSummaryHtml (web adapter)', () => {
  it('renders a document with the recipient, EN section titles and the confidentiality line', () => {
    const html = generateCareSummaryHtml({
      recipientName: 'Ada Lovelace',
      recipientDob: '1950-12-10',
      recipientConditions: ['Diabetes'],
      emergencyInfo,
      medications: [medication],
      careRecipientTimezone: DENVER,
      preparedBy: 'Charles Babbage',
    });
    expect(html).toMatch(/^\s*<!DOCTYPE html>/i);
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Current medications');
    expect(html).toContain('Emergency contacts');
    expect(html).toContain('Healthcare providers');
    expect(html).toContain('Confidential: contains personal health information');
    expect(html).toContain('Prepared by Charles Babbage');
    expect(html).toContain('Metformin');
    expect(html).toContain('8:00 AM');
    expect(html).toContain('Daily');
    expect(html).toContain('data:image/png;base64,');
    // No unresolved mobile-namespace keys leaked into the output.
    expect(html).not.toMatch(/careSummary\./);
  });

  it('renders the plain-text variant with the same anchors', () => {
    const text = generateCareSummaryText({
      recipientName: 'Ada Lovelace',
      recipientDob: null,
      recipientConditions: null,
      emergencyInfo: null,
      medications: [],
      careRecipientTimezone: DENVER,
    });
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('Confidential: contains personal health information');
    expect(text).not.toContain('<');
  });

  // Product decision 2026-09-29 (docs/plans/mobile-web-decisions-2026-09-29.md
  // T1): code status / advance directives are hidden on both apps and never
  // printed. The stored values are kept; only the document drops them.
  it('never prints code status or advance directives, in either variant', () => {
    const base = {
      recipientName: 'Ada Lovelace',
      recipientDob: null,
      recipientConditions: null,
      medications: [],
      careRecipientTimezone: DENVER,
    };
    const onFile: EmergencyInfo = {
      ...emergencyInfo,
      has_dnr: true,
      advance_directives: 'No intubation',
      dnr_document_url: 'https://example.com/dnr.pdf',
    };
    const html = generateCareSummaryHtml({ ...base, emergencyInfo: onFile });
    const text = generateCareSummaryText({ ...base, emergencyInfo: onFile });
    for (const out of [html, text]) {
      for (const needle of ['Code status', 'DNR', 'Advance directives', 'No intubation', 'dnr.pdf']) {
        expect(out).not.toContain(needle);
      }
      // The rest of the patient block is untouched.
      expect(out).toContain('Penicillin');
      expect(out).toContain('Charles Babbage');
    }
    // The directive fields have no effect on the document at all.
    expect(html).toBe(generateCareSummaryHtml({ ...base, emergencyInfo }));
    expect(text).toBe(generateCareSummaryText({ ...base, emergencyInfo }));
  });

  // PK26: a course ended with "This and future" (recurrence_end_date, no discontinued_at)
  // is under "Recently stopped" with that date, not in the current table.
  it('lists an ended course under Recently stopped with its end date', () => {
    const ended = {
      ...medication,
      id: 'abx',
      title: 'Amoxicillin',
      medication_name: 'Amoxicillin',
      recurrence_end_date: '2020-01-05',
    } as typeof medication;
    const html = generateCareSummaryHtml({
      recipientName: 'Ada Lovelace',
      recipientDob: null,
      recipientConditions: null,
      emergencyInfo,
      medications: [medication, ended],
      careRecipientTimezone: DENVER,
    });
    const stoppedAt = html.indexOf('Recently stopped medications');
    expect(stoppedAt).toBeGreaterThan(0);
    const current = html.slice(html.indexOf('id="section-meds"'), stoppedAt);
    const stopped = html.slice(stoppedAt, html.indexOf('id="section-doctors"'));
    expect(current).toContain('Metformin');
    expect(current).not.toContain('Amoxicillin');
    expect(stopped).toContain('Amoxicillin');
    expect(stopped).toContain('January 5, 2020');
    const text = generateCareSummaryText({
      recipientName: 'Ada Lovelace',
      recipientDob: null,
      recipientConditions: null,
      emergencyInfo,
      medications: [ended],
      careRecipientTimezone: DENVER,
    });
    expect(text).toContain('Amoxicillin');
    expect(text).toContain('January 5, 2020');
  });

  it('careSummaryFileTitle mirrors the mobile file name', () => {
    expect(careSummaryFileTitle('Ada Lovelace')).toBe('CircleCare_Summary_Ada_Lovelace');
    expect(careSummaryFileTitle('  Ada   Byron  King ')).toBe('CircleCare_Summary_Ada_Byron_King');
  });
});

describe('generateAdherenceReportHtml (web adapter)', () => {
  it('renders a document with the recipient, EN section titles and the confidentiality line', () => {
    const html = generateAdherenceReportHtml({
      report,
      careRecipientName: 'Ada Lovelace',
      circleName: "Ada's Circle",
      careRecipientTimezone: DENVER,
      recipientDob: '1950-12-10',
      preparedBy: 'Charles Babbage',
      vitalsData: [
        { type: 'Blood Pressure', latest: { value1: 120, value2: 80, unit: 'mmHg' }, average: 118, min: 110, max: 125 },
      ],
    });
    expect(html).toMatch(/^\s*<!DOCTYPE html>/i);
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain('Adherence report');
    expect(html).toContain('By medication');
    expect(html).toContain('Daily breakdown');
    expect(html).toContain('Health vitals');
    expect(html).toContain('Confidential: protected health information');
    expect(html).toContain('Prepared by Charles Babbage');
    expect(html).toContain('Metformin');
    expect(html).not.toMatch(/medicationHistory\./);
  });

  it('adherenceReportFileTitle mirrors the mobile file name', () => {
    expect(adherenceReportFileTitle('Ada Lovelace', 30)).toBe('CircleCare_Adherence_Ada_Lovelace_30d');
  });
  // PK25 (docs/plans/approved-recs-2026-09-30.md): a med that started mid-window has no
  // comparable half, so the server sends trend_available:false and the PDF prints NO badge
  // (the shipped template would print "Stable (0%)", the bug before it "Improving (+80%)").
  it('hides the trend badge when trend_available is false, shows it otherwise', () => {
    const base = {
      careRecipientName: 'Ada Lovelace',
      circleName: "Ada's Circle",
      careRecipientTimezone: DENVER,
    };
    const improving = {
      ...report,
      summary: { ...report.summary, trend: 'improving' as const, trend_change: 12 },
    };
    expect(generateAdherenceReportHtml({ ...base, report: improving })).toContain('+12%');
    expect(
      generateAdherenceReportHtml({
        ...base,
        report: { ...improving, summary: { ...improving.summary, trend_available: true } },
      })
    ).toContain('+12%');
    const hidden = generateAdherenceReportHtml({
      ...base,
      report: {
        ...improving,
        summary: { ...improving.summary, trend: 'stable', trend_change: 0, trend_available: false },
      },
    });
    expect(hidden).not.toContain('trend-badge" style');
    expect(hidden).not.toMatch(/Improving|Stable|Declining/);
  });

  // PK26: every date of the header range is a no-wrap unit (the ES year wrapped alone).
  it('keeps each header date unbreakable (no year orphaned onto its own line)', () => {
    const html = generateAdherenceReportHtml({
      report,
      careRecipientName: 'Ada Lovelace',
      circleName: "Ada's Circle",
      careRecipientTimezone: DENVER,
    });
    const title = html.match(/<div class="report-title">([\s\S]*?)<\/div>/)?.[1] ?? '';
    expect(title.match(/<span style="white-space:nowrap">[^<]+<\/span>/g)).toHaveLength(2);
  });
});
