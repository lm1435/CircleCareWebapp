import { quietHoursCoverAlmostAllDay, quietWindowMinutes } from '../quietHours';

describe('quietWindowMinutes', () => {
  it.each([
    ['22:00', '07:00', 540],
    ['22:00', '21:59', 1439],
    ['09:00', '17:00', 480],
    ['00:00', '23:59', 1439],
    ['22:00:00', '07:00:00', 540],
  ])('%s -> %s = %i min', (s, e, m) => {
    expect(quietWindowMinutes(s, e)).toBe(m);
  });
  it('start == end is an EMPTY window (backend isTimeInRange never matches)', () => {
    expect(quietWindowMinutes('22:00', '22:00')).toBe(0);
  });
  it('returns null for unparseable input', () => {
    expect(quietWindowMinutes('99:99', '07:00')).toBeNull();
    expect(quietWindowMinutes('', '07:00')).toBeNull();
  });
});

describe('quietHoursCoverAlmostAllDay', () => {
  it('warns when < 60 min is left outside quiet hours', () => {
    expect(quietHoursCoverAlmostAllDay('22:00', '21:59')).toBe(true);
    expect(quietHoursCoverAlmostAllDay('22:00', '21:01')).toBe(true);
    expect(quietHoursCoverAlmostAllDay('00:00', '23:30')).toBe(true);
  });
  it('does not warn at exactly 60 min outside or for normal windows', () => {
    expect(quietHoursCoverAlmostAllDay('22:00', '21:00')).toBe(false);
    expect(quietHoursCoverAlmostAllDay('22:00', '07:00')).toBe(false);
  });
  it('does not warn for start == end (0 h, not 24 h) or bad input', () => {
    expect(quietHoursCoverAlmostAllDay('22:00', '22:00')).toBe(false);
    expect(quietHoursCoverAlmostAllDay('xx', '22:00')).toBe(false);
  });
});

// ─── Dose-time warning helpers ──────────────────────────────────────────────
import {
  doseFallsInOwnQuietHours,
  doseReminderRecipientId,
  isInstantInQuietHours,
  isMinuteInQuietWindow,
  minuteOfDayInZone,
} from '../quietHours';

describe('isMinuteInQuietWindow (mirror of backend isTimeInRange)', () => {
  it('overnight window: inside late evening and early morning, outside midday', () => {
    expect(isMinuteInQuietWindow(23 * 60, '22:00', '07:00')).toBe(true);
    expect(isMinuteInQuietWindow(2 * 60, '22:00', '07:00')).toBe(true);
    expect(isMinuteInQuietWindow(12 * 60, '22:00', '07:00')).toBe(false);
  });
  it('start is inclusive, end is exclusive', () => {
    expect(isMinuteInQuietWindow(22 * 60, '22:00', '07:00')).toBe(true);
    expect(isMinuteInQuietWindow(7 * 60 - 1, '22:00', '07:00')).toBe(true);
    expect(isMinuteInQuietWindow(7 * 60, '22:00', '07:00')).toBe(false);
    expect(isMinuteInQuietWindow(22 * 60 - 1, '22:00', '07:00')).toBe(false);
  });
  it('same-day window', () => {
    expect(isMinuteInQuietWindow(13 * 60, '13:00', '15:00')).toBe(true);
    expect(isMinuteInQuietWindow(15 * 60, '13:00', '15:00')).toBe(false);
    expect(isMinuteInQuietWindow(2 * 60, '13:00', '15:00')).toBe(false);
  });
  it('start == end is EMPTY, accepts HH:MM:SS, and unparseable is false', () => {
    expect(isMinuteInQuietWindow(22 * 60, '22:00', '22:00')).toBe(false);
    expect(isMinuteInQuietWindow(23 * 60, '22:00:00', '07:00:00')).toBe(true);
    expect(isMinuteInQuietWindow(23 * 60, 'xx', '07:00')).toBe(false);
  });
});

describe('minuteOfDayInZone', () => {
  it('reads the wall clock in the given zone (DST aware)', () => {
    // 2026-07-10 04:00Z = 22:00 MDT (UTC-6); 2026-01-10 05:00Z = 22:00 MST (UTC-7)
    expect(minuteOfDayInZone(new Date('2026-07-10T04:00:00Z'), 'America/Denver')).toBe(22 * 60);
    expect(minuteOfDayInZone(new Date('2026-01-10T05:00:00Z'), 'America/Denver')).toBe(22 * 60);
  });
  it('midnight is 0, never 1440', () => {
    expect(minuteOfDayInZone(new Date('2026-01-10T07:00:00Z'), 'America/Denver')).toBe(0);
  });
  it('null / invalid zone falls back to America/New_York like the backend', () => {
    const at = new Date('2026-01-10T03:30:00Z'); // 22:30 EST
    expect(minuteOfDayInZone(at, null)).toBe(22 * 60 + 30);
    expect(minuteOfDayInZone(at, 'Not/AZone')).toBe(22 * 60 + 30);
  });
});

describe('isInstantInQuietHours', () => {
  const tenPmDenver = new Date('2026-07-10T04:00:00Z'); // 22:00 MDT
  it('inside an overnight window (across midnight)', () => {
    expect(isInstantInQuietHours(tenPmDenver, 'America/Denver', '22:00', '07:00')).toBe(true);
    const threeAm = new Date('2026-07-10T09:00:00Z'); // 03:00 MDT
    expect(isInstantInQuietHours(threeAm, 'America/Denver', '22:00:00', '07:00:00')).toBe(true);
  });
  it('outside the window', () => {
    const noon = new Date('2026-07-10T18:00:00Z'); // 12:00 MDT
    expect(isInstantInQuietHours(noon, 'America/Denver', '22:00', '07:00')).toBe(false);
  });
  it('NULL / empty on either bound means OFF: never inside', () => {
    expect(isInstantInQuietHours(tenPmDenver, 'America/Denver', null, null)).toBe(false);
    expect(isInstantInQuietHours(tenPmDenver, 'America/Denver', '22:00', null)).toBe(false);
    expect(isInstantInQuietHours(tenPmDenver, 'America/Denver', undefined, '07:00')).toBe(false);
    expect(isInstantInQuietHours(tenPmDenver, 'America/Denver', '', '')).toBe(false);
  });
  it('FALSIFIER: the SAME instant is judged in the given zone, not the device zone', () => {
    // 22:00 in Denver is 00:00 in New York; a 23:00-06:00 window splits them.
    expect(isInstantInQuietHours(tenPmDenver, 'America/Denver', '23:00', '06:00')).toBe(false);
    expect(isInstantInQuietHours(tenPmDenver, 'America/New_York', '23:00', '06:00')).toBe(true);
  });
});

describe('doseReminderRecipientId (the backend rule)', () => {
  const owner = { id: 'owner', role: 'owner' };
  const member = { id: 'mem', role: 'member' };
  const recipient = { id: 'rec', role: 'member', is_care_recipient: true };
  const responsible = { id: 'resp', role: 'member', is_medication_responsible: true };

  it('responsible member wins over care recipient and owner', () => {
    expect(doseReminderRecipientId([owner, recipient, responsible], 'owner')).toBe('resp');
  });
  it('else the care-recipient member', () => {
    expect(doseReminderRecipientId([owner, member, recipient], 'owner')).toBe('rec');
  });
  it('else the circle owner', () => {
    expect(doseReminderRecipientId([owner, member], 'owner')).toBe('owner');
    expect(doseReminderRecipientId([owner, member], null)).toBe('owner');
  });
  it('not loaded -> null (never guess)', () => {
    expect(doseReminderRecipientId(undefined, 'owner')).toBeNull();
    expect(doseReminderRecipientId([], 'owner')).toBeNull();
  });
});

describe('doseFallsInOwnQuietHours', () => {
  const instant = new Date('2026-07-10T04:00:00Z'); // 22:00 MDT
  const base = {
    instant,
    members: [
      { id: 'me', role: 'owner' },
      { id: 'other', role: 'member', is_medication_responsible: true },
    ],
    ownerId: 'me',
    viewerId: 'me',
    viewerTimezone: 'America/Denver',
    quietHoursStart: '22:00',
    quietHoursEnd: '07:00',
  };
  const solo = { ...base, members: [{ id: 'me', role: 'owner' }] };

  it('responsible member is SOMEONE ELSE: no warning (their quiet hours are not exposed)', () => {
    expect(doseFallsInOwnQuietHours(base)).toBe(false);
  });
  it('viewer IS the responsible member and the time is inside: warns', () => {
    expect(
      doseFallsInOwnQuietHours({
        ...base,
        members: [
          { id: 'me', role: 'member', is_medication_responsible: true },
          { id: 'o', role: 'owner' },
        ],
        ownerId: 'o',
      })
    ).toBe(true);
  });
  it('no responsible, no care recipient: the owner (viewer) is the recipient and warns', () => {
    expect(doseFallsInOwnQuietHours(solo)).toBe(true);
  });
  it('viewer is the care recipient and the time is inside: warns', () => {
    expect(
      doseFallsInOwnQuietHours({
        ...base,
        members: [
          { id: 'me', role: 'member', is_care_recipient: true },
          { id: 'o', role: 'owner' },
        ],
        ownerId: 'o',
      })
    ).toBe(true);
  });
  it('outside the window: no warning', () => {
    expect(doseFallsInOwnQuietHours({ ...solo, instant: new Date('2026-07-10T18:00:00Z') })).toBe(
      false
    );
  });
  it('NULL quiet hours (the new default): never warns', () => {
    expect(doseFallsInOwnQuietHours({ ...solo, quietHoursStart: null, quietHoursEnd: null })).toBe(
      false
    );
  });
  it('signed-out / members not loaded: no warning', () => {
    expect(doseFallsInOwnQuietHours({ ...solo, viewerId: undefined })).toBe(false);
    expect(doseFallsInOwnQuietHours({ ...solo, members: undefined })).toBe(false);
  });
  it('FALSIFIER: flipping only the viewer timezone flips the answer', () => {
    const split = { ...solo, quietHoursStart: '23:00', quietHoursEnd: '06:00' };
    expect(doseFallsInOwnQuietHours({ ...split, viewerTimezone: 'America/Denver' })).toBe(false);
    expect(doseFallsInOwnQuietHours({ ...split, viewerTimezone: 'America/New_York' })).toBe(true);
  });
});
