/**
 * BC-1: every dose row of one NEW multi-dose medication starts on the SAME circle-zone day (the primary's), at its
 * own circle-clock HH:MM. The extra dose is held as a viewer-frame clock with no day of its own; placing it on the
 * primary's VIEWER day moved a dose whose real instant is on another viewer day one circle day early (and, across a
 * clock change, an hour). The viewer is the process zone (TZ); run under the six zones from the shell.
 */
import { describe, expect, it } from 'vitest';
import { eventDatesFromApi, extraDoseForApi } from '@/utils/recipientEventDate';
import {
  EXPECTED_2026,
  assertTableMatchesRuntime,
  discoverTransitions,
} from './helpers/dstTransitions';

const AMBIENT = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** [ambient viewer zone(s), circle, primary, extra] on circle day 2026-11-12. */
const TABLE: Array<{ viewer: string[]; circle: string; primary: string; extra: string }> = [
  { viewer: ['America/Denver'], circle: 'Asia/Tokyo', primary: '08:00', extra: '21:00' },
  { viewer: ['UTC', 'Etc/UTC'], circle: 'America/Denver', primary: '08:00', extra: '18:00' },
  { viewer: ['America/New_York'], circle: 'America/Los_Angeles', primary: '08:00', extra: '21:00' },
  { viewer: ['Europe/London'], circle: 'America/Denver', primary: '08:00', extra: '18:00' },
  { viewer: ['Pacific/Auckland'], circle: 'Europe/London', primary: '08:00', extra: '18:00' },
  { viewer: ['Asia/Kolkata', 'Asia/Calcutta'], circle: 'America/Los_Angeles', primary: '08:00', extra: '21:00' },
];

/** The two rows the form saves: build the inputs the way the form does (chips -> viewer-frame strings). */
function rows(circle: string, day: string, primary: string, extra: string) {
  const p = eventDatesFromApi({ scheduledDate: day, scheduledTime: primary, timezone: circle });
  const e = eventDatesFromApi({ scheduledDate: day, scheduledTime: extra, timezone: circle });
  return extraDoseForApi({
    dateStr: p.dateStr,
    timeStr: p.timeStr,
    extraTimeStr: e.timeStr,
    timezone: circle,
    heldInstant: p.instant,
    heldExtraInstant: e.instant,
  });
}

describe('BC-1 extraDoseForApi', () => {
  it('the ambient zone is in the table', () => {
    if (!TABLE.some((r) => r.viewer.includes(AMBIENT))) {
      throw new Error(`ambient zone ${AMBIENT} is not in the BC-1 table; run under the six zones`);
    }
  });

  it('two doses from another zone start on the same circle day (the ambient case)', () => {
    const row = TABLE.find((r) => r.viewer.includes(AMBIENT));
    if (!row) throw new Error(`ambient zone ${AMBIENT} is not in the BC-1 table`);
    const extra = rows(row.circle, '2026-11-12', row.primary, row.extra);
    expect(extra).toEqual({ scheduledDate: '2026-11-12', scheduledTime: row.extra });
  });

  it('every row of the table, for the viewer zone it names, was wrong before: the extra stayed on the primary viewer day', () => {
    // Zone-independent check of the SAME rows with the viewer-day placement the form used (a fixed candidate k = 0),
    // done with Intl: the saved date of the extra on the primary's viewer day is 11-11 in the table's rows.
    const row = TABLE.find((r) => r.viewer.includes(AMBIENT));
    if (!row) throw new Error(`ambient zone ${AMBIENT} is not in the BC-1 table`);
    const p = eventDatesFromApi({ scheduledDate: '2026-11-12', scheduledTime: row.primary, timezone: row.circle });
    const e = eventDatesFromApi({ scheduledDate: '2026-11-12', scheduledTime: row.extra, timezone: row.circle });
    const [y, m, d] = p.dateStr.split('-').map(Number);
    const [hh, mm] = e.timeStr.split(':').map(Number);
    const old = new Date(y, m - 1, d, hh, mm);
    const oldDay = new Intl.DateTimeFormat('en-CA', { timeZone: row.circle }).format(old);
    expect(oldDay).toBe('2026-11-11');
  });

  // The extra's clock is on the SECOND reading of the VIEWER's own repeated (fall-back) hour: the string reads as
  // the first reading (an hour early) unless the dose's instant rides along. [viewer, circle, day, primary, extra]
  it.each([
    ['Europe/London', 'America/New_York', '2026-10-24', '08:00', '21:00'],
    ['America/Denver', 'Europe/London', '2026-11-01', '08:00', '08:00'],
    ['America/Los_Angeles', 'Asia/Tokyo', '2026-11-01', '09:00', '18:00'],
    ['America/New_York', 'Asia/Tokyo', '2026-11-01', '09:00', '15:30'],
    ['Pacific/Auckland', 'Europe/London', '2026-04-04', '09:00', '15:30'],
  ] as const)('viewer %s, circle %s, %s: the extra %s keeps its clock', (viewer, circle, day, primary, extra) => {
    if (AMBIENT !== viewer) return; // the viewer is the process zone
    expect(rows(circle, day, primary, extra)).toEqual({ scheduledDate: day, scheduledTime: extra });
  });

  it('a primary without a time keeps the viewer day', () => {
    const out = extraDoseForApi({
      dateStr: '2026-11-12',
      timeStr: '',
      extraTimeStr: '10:00',
      timezone: 'UTC',
    });
    expect(out.scheduledDate).toBe('2026-11-12');
  });

  describe('clock-change days: the saved clock equals the picked clock, on the primary circle day', () => {
    assertTableMatchesRuntime();
    const cases: Array<[string, string]> = [];
    for (const zone of Object.keys(EXPECTED_2026)) {
      for (const tr of discoverTransitions(zone)) cases.push([zone, tr.day]);
    }
    let checked = 0;
    const check = (zone: string, day: string) => {
      for (const extra of ['18:00', '21:00']) {
        expect(rows(zone, day, '08:00', extra)).toEqual({ scheduledDate: day, scheduledTime: extra });
        checked++;
      }
    };
    it.each(cases)('%s on %s: 18:00 and 21:00', (zone, day) => {
      check(zone, day);
    });
    it.each(cases)('%s on %s: the day before and after', (zone, day) => {
      for (const n of [-1, 1]) check(zone, new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10));
    });
    it('every case was exercised (the viewer repeated hour included)', () => {
      expect(checked).toBeGreaterThan(100);
    });
  });
});
