/**
 * Web twin of mobile/src/__tests__/pdf/hardExportFarZone.test.ts: the Care
 * Summary's medication lists for the shared "hard" export dataset
 * (docs/plans/export-test-coverage-2026-09-30.md), through the REAL shared
 * selection + the WEB adapter (real i18n), for a recipient far from the host:
 * one row per medication across dose times, an ENDED series not current, a
 * DISCONTINUED series "recently stopped" on the RECIPIENT's day (2026-09-27T22:00Z
 * = Sep 28 in Kiritimati, Sep 27 in Midway), code status never printed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { queryClient } from '@/lib/queryClient';
import type { CalendarEvent } from '@/api/calendarEvents';
import type { EmergencyInfo } from '@/api/emergencyInfo';
import { generateCareSummaryHtml } from '../careSummaryPdf';
import { selectCareSummaryMedications } from '../shared/medicationSelection';
import { getDateInTimezone } from '@/utils/timezone';

const STOP = '2026-09-27T22:00:00Z';
const NOW = new Date('2026-09-30T16:00:00Z');
const DNR = 'DNRMARKER do not resuscitate';

function ev(id: string, name: string, dosage: string, time: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    circle_id: 'c1',
    event_type: 'medication',
    title: name,
    medication_name: name,
    medication_dosage: dosage,
    scheduled_date: '2026-09-21',
    scheduled_time: time,
    recurrence_rule: 'daily',
    parent_event_id: null,
    discontinued_at: null,
    recurrence_end_date: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...extra,
  } as CalendarEvent;
}

const events: CalendarEvent[] = [
  ev('met-am', 'Metformin', '500mg', '08:00:00'),
  ev('met-am-c1', 'Metformin', '500mg', '08:00:00', { parent_event_id: 'met-am', scheduled_date: '2026-09-28' }),
  ev('met-pm', 'Metformin', '500mg', '20:00:00'),
  ev('lis-am', 'Lisinopril', '10mg', '09:00:00', { scheduled_date: '2026-09-25' }),
  ev('lis-pm', 'Lisinopril', '10mg', '21:00:00', { scheduled_date: '2026-09-25' }),
  ev('ato', 'Atorvastatin', '20mg', '22:00:00', { scheduled_date: '2026-09-19', recurrence_end_date: '2026-09-27' }),
  ev('war', 'Warfarin', '5mg', '18:00:00', { scheduled_date: '2026-09-22', discontinued_at: STOP }),
  ev('war-c1', 'Warfarin', '5mg', '18:00:00', { parent_event_id: 'war', scheduled_date: '2026-09-26', discontinued_at: STOP }),
];

const emergencyInfo = {
  id: 'ei1',
  circle_id: 'c1',
  medication_allergies: ['Penicillin'],
  allergies: ['Peanuts'],
  medical_conditions: ['Type 2 diabetes'],
  has_dnr: true,
  advance_directives: DNR,
} as unknown as EmergencyInfo;

function render(tz: string) {
  const todayStr = getDateInTimezone(tz, NOW);
  const { forExport } = selectCareSummaryMedications(events, { todayStr, careRecipientTimezone: tz, getDateInTimezone, now: NOW });
  const html = generateCareSummaryHtml({
    recipientName: 'Pat Doe',
    recipientDob: null,
    recipientConditions: ['Type 2 diabetes'],
    emergencyInfo,
    medications: forExport,
    careRecipientTimezone: tz,
  });
  const meds = html.indexOf('id="section-meds"');
  const stoppedAt = html.indexOf('Recently stopped medications', meds);
  const doctors = html.indexOf('id="section-doctors"');
  return {
    html,
    current: html.slice(meds, stoppedAt > 0 ? stoppedAt : doctors),
    stopped: stoppedAt > 0 ? html.slice(stoppedAt, doctors) : '',
  };
}

/** The <tr> of the stopped table that names `name`. */
function rowOf(html: string, name: string): string {
  return html.split('<tr').find((r) => r.includes(name)) ?? '';
}

beforeEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
  queryClient.clear();
});

describe('care summary — hard export dataset, recipient far from the browser', () => {
  it('Kiritimati (UTC+14): one Metformin row (8 AM + 8 PM) + Lisinopril; Warfarin stopped Sep 28; Atorvastatin (ended) not current but Recently stopped on its end date Sep 27', () => {
    const { current, stopped } = render('Pacific/Kiritimati');
    expect(current.split('Metformin').length - 1).toBe(1);
    expect(current).toMatch(/Metformin[\s\S]*?8:00\s?AM, 8:00\s?PM/);
    expect(current).toMatch(/Lisinopril[\s\S]*?9:00\s?AM, 9:00\s?PM/);
    expect(current).not.toContain('Atorvastatin');
    expect(current).not.toContain('Warfarin');
    expect(rowOf(stopped, 'Warfarin')).toContain('September 28, 2026');
    expect(rowOf(stopped, 'Warfarin')).not.toContain('September 27, 2026');
    // PK26: a course ended with "This and future" (no discontinued_at) is listed under
    // Recently stopped, with its recurrence_end_date as the stop date (naive: same in every zone).
    expect(rowOf(stopped, 'Atorvastatin')).toContain('September 27, 2026');
    // Newest stop first: Sep 28 before Sep 27.
    expect(stopped.indexOf('Warfarin')).toBeLessThan(stopped.indexOf('Atorvastatin'));
  });

  it('Midway (UTC-11): the same stop instant is Sep 27', () => {
    const { stopped } = render('Pacific/Midway');
    expect(rowOf(stopped, 'Warfarin')).toContain('September 27, 2026');
    // The ended course's date does not move with the viewer/recipient zone.
    expect(rowOf(stopped, 'Atorvastatin')).toContain('September 27, 2026');
  });

  it('never prints code status, even with a DNR on file', () => {
    const { html } = render('Pacific/Kiritimati');
    expect(html).not.toContain(DNR);
    expect(html).not.toMatch(/Code status|advance directive/i);
  });
});
