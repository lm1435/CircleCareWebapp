import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { formatEventTimeForDisplay, zoneReferenceInstant } from '../timezone';

/**
 * The viewer half of a dual-zone time NAMES ITS DAY when it falls on another
 * calendar day than the recipient's half. Twin of mobile's
 * `src/__tests__/utils/dualTimeDayMarker.test.ts`; same cases, same strings.
 *
 * Owner report (TestFlight 1.4.0 (8), phone in Pacific/Auckland, recipient in
 * America/Denver): "Mon, Nov 2 · 9:00 AM (Denver) / 5:00 AM (Auckland)". 9:00 AM
 * Monday in Denver is 5:00 AM TUESDAY in Auckland.
 *
 * The viewer zone is pinned through `resolvedOptions` (only getDeviceTimezone
 * reads it), so these hold under every TZ the sweep runs.
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

const dual = (time: string, zone: string, when: Parameters<typeof formatEventTimeForDisplay>[3]) =>
  formatEventTimeForDisplay(time, zone, undefined, when, '12h');

beforeEach(() => {
  viewerZone = 'Pacific/Auckland';
  setLanguage('en');
});
afterEach(() => {
  viewerZone = 'Pacific/Auckland';
});
afterAll(() => {
  lang.language = ORIGINAL_LANGUAGE;
});

describe('the viewer half names its day when it differs', () => {
  it('Denver -> Auckland, next day: the owner report', () => {
    expect(dual('09:00:00', 'America/Denver', '2026-11-02')).toBe(
      '9:00 AM (Denver) / Tue 5:00 AM (Auckland)'
    );
  });

  it('Auckland -> Denver, previous day', () => {
    viewerZone = 'America/Denver';
    expect(dual('05:00', 'Pacific/Auckland', '2026-11-03')).toBe(
      '5:00 AM (Auckland) / Mon 9:00 AM (Denver)'
    );
  });

  it('Kiritimati (+14) viewed from Midway (-11): TWO days back', () => {
    viewerZone = 'Pacific/Midway';
    expect(dual('00:30', 'Pacific/Kiritimati', '2026-09-01')).toBe(
      '12:30 AM (Kiritimati) / Sun 11:30 PM (Midway)'
    );
  });

  it('Midway (-11) viewed from Kiritimati (+14): TWO days ahead', () => {
    viewerZone = 'Pacific/Kiritimati';
    expect(dual('23:30', 'Pacific/Midway', '2026-09-01')).toBe(
      '11:30 PM (Midway) / Thu 12:30 AM (Kiritimati)'
    );
  });

  it('crossing a month and year boundary', () => {
    expect(dual('21:00', 'America/Denver', '2026-12-31')).toBe(
      '9:00 PM (Denver) / Fri 5:00 PM (Auckland)'
    );
  });
});

describe('never a marker when the days match, or when no day was given', () => {
  it('same calendar day: no marker', () => {
    viewerZone = 'America/New_York';
    expect(dual('09:00', 'America/Denver', '2026-11-02')).toBe(
      '9:00 AM (Denver) / 11:00 AM (New York)'
    );
  });

  it('a bare instant is not a day: no marker even though the days differ', () => {
    expect(dual('09:00', 'America/Denver', zoneReferenceInstant('2026-11-02'))).toBe(
      '9:00 AM (Denver) / 5:00 AM (Auckland)'
    );
  });

  it('undefined / null (rows with no date): no marker', () => {
    for (const out of [dual('09:00', 'America/Denver', undefined), dual('09:00', 'America/Denver', null)]) {
      expect(out).toMatch(/^9:00 AM \(Denver\) \/ \d{1,2}:00 AM \(Auckland\)$/);
    }
  });

  it('a malformed date is treated as no date', () => {
    expect(dual('09:00', 'America/Denver', '2026-02-31')).not.toMatch(/\/ \S+ \d/);
    expect(dual('09:00', 'America/Denver', 'not a date')).not.toMatch(/\/ \S+ \d/);
  });

  it('single-time display (showDualTimezone false) never carries a marker', () => {
    expect(formatEventTimeForDisplay('09:00', 'America/Denver', false, '2026-11-02', '12h')).toBe(
      '9:00 AM (Denver)'
    );
  });
});

describe("DST: the day is judged at the event's real instant", () => {
  it('Denver fall-back night viewed from Phoenix: previous day, and the dual line is shown', () => {
    viewerZone = 'America/Phoenix';
    expect(dual('00:30', 'America/Denver', '2026-11-01')).toBe(
      '12:30 AM (Denver) / Sat 11:30 PM (Phoenix)'
    );
  });

  it('Auckland fall-back day: the viewer time uses the offset in force at the event', () => {
    expect(dual('08:30', 'America/Denver', '2027-04-03')).toBe(
      '8:30 AM (Denver) / Sun 2:30 AM (Auckland)'
    );
  });
});

describe('the weekday is in the active language (Intl short weekday)', () => {
  it('es: "mar"', () => {
    setLanguage('es');
    expect(dual('09:00', 'America/Denver', '2026-11-02')).toBe(
      '9:00 a. m. (Denver) / mar 5:00 a. m. (Auckland)'
    );
  });

  it('de: "Di"', () => {
    setLanguage('de');
    expect(dual('09:00', 'America/Denver', '2026-11-02')).toMatch(
      /^9:00 \S+ \(Denver\) \/ Di 5:00 \S+ \(Auckland\)$/
    );
  });

  it.each([
    ['fr', 'mar.'],
    ['fr-CA', 'mar.'],
    ['it', 'mar'],
    ['pt', 'ter.'],
    ['pt-PT', 'terça'],
  ])('%s: "%s"', (lng, weekday) => {
    setLanguage(lng);
    const viewerHalf = dual('09:00', 'America/Denver', '2026-11-02').split(' / ')[1];
    expect(viewerHalf.startsWith(`${weekday} 5:00`)).toBe(true);
  });

  it('24h clock: "Di 05:00"', () => {
    setLanguage('de');
    expect(formatEventTimeForDisplay('09:00', 'America/Denver', undefined, '2026-11-02', '24h')).toBe(
      '09:00 (Denver) / Di 05:00 (Auckland)'
    );
  });
});
