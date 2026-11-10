import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import type { CalendarEvent } from '@/api/calendarEvents';
import { formatShiftRangeViewer } from '../shiftUtils';

/**
 * The care-shift "Your time" range names the VIEWER's day when it is not the
 * recipient's day (same short-weekday marker as the dual-time halves). Twin of
 * mobile's `src/__tests__/utils/shiftViewerDayMarker.test.ts`; same cases, same strings.
 * November 2026: Denver MST (-7), Auckland NZDT (+13), Honolulu HST (-10), New York EST (-5).
 *
 * The viewer zone is pinned through `resolvedOptions` (only getDeviceTimezone reads it).
 */
let viewerZone = 'Pacific/Auckland';
const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
  this: Intl.DateTimeFormat
) {
  return { ...realResolved.call(this), timeZone: viewerZone };
});

const lang = i18n as unknown as { language?: string; resolvedLanguage?: string };
const ORIGINAL_LANGUAGE = lang.language;
function setLanguage(lng: string): void {
  lang.language = lng;
  delete lang.resolvedLanguage;
}
beforeEach(() => setLanguage('en'));
afterEach(() => {
  viewerZone = 'Pacific/Auckland';
});
afterAll(() => {
  lang.language = ORIGINAL_LANGUAGE;
});

const shift = (date: string, time: string, minutes: number) =>
  ({
    scheduled_date: date,
    scheduled_time: time,
    duration_minutes: minutes,
  }) as Pick<CalendarEvent, 'scheduled_date' | 'scheduled_time' | 'duration_minutes'>;

const viewer = (
  s: ReturnType<typeof shift>,
  recipient: string,
  device: string,
  cycle: '12h' | '24h' = '12h'
) => {
  viewerZone = device;
  return formatShiftRangeViewer(s, recipient, cycle);
};

describe('shift "Your time" names the viewer day', () => {
  it('Denver recipient, Auckland viewer: both ends land on Tuesday, named once', () => {
    expect(viewer(shift('2026-11-02', '09:00:00', 480), 'America/Denver', 'Pacific/Auckland')).toBe(
      'Tue 5:00 AM – 1:00 PM'
    );
  });

  it('Auckland recipient, Denver viewer: the previous day', () => {
    expect(viewer(shift('2026-11-03', '05:00:00', 480), 'Pacific/Auckland', 'America/Denver')).toBe(
      'Mon 9:00 AM – 5:00 PM'
    );
  });

  it('crossing midnight for the viewer only: both days named', () => {
    expect(viewer(shift('2026-11-02', '01:00:00', 480), 'America/Denver', 'Pacific/Honolulu')).toBe(
      'Sun 10:00 PM – Mon 6:00 AM'
    );
  });

  it('crossing midnight for both: each end is named, no double mark', () => {
    expect(viewer(shift('2026-11-02', '20:00:00', 480), 'America/Denver', 'Pacific/Auckland')).toBe(
      'Tue 4:00 PM – Wed 12:00 AM'
    );
  });

  it('same calendar day: no marker', () => {
    expect(viewer(shift('2026-11-02', '09:00:00', 480), 'America/Denver', 'America/New_York')).toBe(
      '11:00 AM – 7:00 PM'
    );
  });

  it('only the recipient crosses midnight: viewer on the same days, no marker', () => {
    expect(viewer(shift('2026-11-02', '20:00:00', 480), 'America/Denver', 'America/New_York')).toBe(
      '10:00 PM – 6:00 AM'
    );
  });

  it('same zone: null', () => {
    expect(viewer(shift('2026-11-02', '09:00:00', 480), 'America/Denver', 'America/Denver')).toBeNull();
  });

  it('Spanish weekday', () => {
    setLanguage('es');
    expect(viewer(shift('2026-11-02', '09:00:00', 480), 'America/Denver', 'Pacific/Auckland')).toMatch(
      /^mar 5:00/
    );
  });

  it('German weekday', () => {
    setLanguage('de');
    expect(viewer(shift('2026-11-02', '09:00:00', 480), 'America/Denver', 'Pacific/Auckland')).toMatch(
      /^Di 5:00/
    );
  });
});

describe('shift "Your time" converts at the real instant on a DST-change day', () => {
  // The cron's instant (Postgres `AT TIME ZONE`, `wallTimeToInstant`), not the day's
  // noon offset. Twin of mobile shiftViewerDayMarker.test.ts. Monterrey is UTC-6 all year.
  it('NY fall-back day: 00:30 is still EDT; the 01:30 end is the SECOND (EST) occurrence', () => {
    // 00:30 EDT = 04:30Z = Sat 10:30 PM Monterrey; 01:30 EST = 06:30Z = Sun 12:30 AM.
    // The noon offset (EST) used to put the start at 11:30 PM.
    expect(viewer(shift('2027-11-07', '00:30:00', 60), 'America/New_York', 'America/Monterrey')).toBe(
      'Sat 10:30 PM – Sun 12:30 AM'
    );
  });

  it('NY spring-forward day: a 02:30 start (missing hour) is the 03:30 EDT the reminder fires at', () => {
    // 02:30 -> 07:30Z = 1:30 AM Monterrey (was 12:30 AM); 04:30 EDT end = 08:30Z = 2:30 AM.
    expect(viewer(shift('2027-03-14', '02:30:00', 120), 'America/New_York', 'America/Monterrey')).toBe(
      '1:30 AM – 2:30 AM'
    );
  });
});
