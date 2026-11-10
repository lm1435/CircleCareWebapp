import { describe, expect, it } from 'vitest';
import { wallTimeToInstant } from '../wallTimeToInstant';

// Every expected instant below was read off Postgres on the local DB:
//   SELECT (date + time) AT TIME ZONE zone
// which is what the pg_cron reminder / escalation SQL does. Rule: a REPEATED
// wall time takes the offset AFTER the transition (second occurrence); a
// MISSING one takes the offset BEFORE it. Pure Intl, so the answer must not
// depend on the process TZ (run under TZ=UTC / America/Denver / Pacific/Auckland).
const PG: Array<[why: string, date: string, time: string, zone: string, pg: string]> = [
  ['NY repeated 01:30 -> second (EST)', '2027-11-07', '01:30:00', 'America/New_York', '2027-11-07T06:30:00Z'],
  ['NY missing 02:30 -> pre-jump EST', '2027-03-14', '02:30:00', 'America/New_York', '2027-03-14T07:30:00Z'],
  ['NY missing 02:00 (gap start)', '2027-03-14', '02:00:00', 'America/New_York', '2027-03-14T07:00:00Z'],
  ['NY 03:00 right after the gap', '2027-03-14', '03:00:00', 'America/New_York', '2027-03-14T07:00:00Z'],
  ['NY 00:59 before fall-back', '2027-11-07', '00:59:00', 'America/New_York', '2027-11-07T04:59:00Z'],
  ['NY 02:00 after fall-back', '2027-11-07', '02:00:00', 'America/New_York', '2027-11-07T07:00:00Z'],
  ['NY ordinary summer evening', '2027-07-15', '20:00:00', 'America/New_York', '2027-07-16T00:00:00Z'],
  ['London repeated 01:30 -> GMT', '2027-10-31', '01:30:00', 'Europe/London', '2027-10-31T01:30:00Z'],
  ['London missing 01:30 -> pre-jump GMT', '2027-03-28', '01:30:00', 'Europe/London', '2027-03-28T01:30:00Z'],
  ['Sydney repeated 02:30 -> AEST', '2027-04-04', '02:30:00', 'Australia/Sydney', '2027-04-03T16:30:00Z'],
  ['Sydney missing 02:30 -> pre-jump AEST', '2027-10-03', '02:30:00', 'Australia/Sydney', '2027-10-02T16:30:00Z'],
  ['Lord Howe repeated 01:45 (30-min DST)', '2027-04-04', '01:45:00', 'Australia/Lord_Howe', '2027-04-03T15:15:00Z'],
  ['Lord Howe missing 02:15 (30-min DST)', '2027-10-03', '02:15:00', 'Australia/Lord_Howe', '2027-10-02T15:45:00Z'],
  ['Chatham repeated 03:00 (+13:45 -> +12:45)', '2027-04-04', '03:00:00', 'Pacific/Chatham', '2027-04-03T14:15:00Z'],
  ['Chatham missing 03:00 (+12:45 -> +13:45)', '2027-09-26', '03:00:00', 'Pacific/Chatham', '2027-09-25T14:15:00Z'],
  ['Chatham 02:00 before the gap', '2027-09-26', '02:00:00', 'Pacific/Chatham', '2027-09-25T13:15:00Z'],
  ['Monterrey (no DST) on the US gap day', '2027-03-14', '02:30:00', 'America/Monterrey', '2027-03-14T08:30:00Z'],
  ['Monterrey (no DST) on the US repeat day', '2027-11-07', '01:30:00', 'America/Monterrey', '2027-11-07T07:30:00Z'],
  ['Phoenix (no DST) on the US gap day', '2027-03-14', '02:30:00', 'America/Phoenix', '2027-03-14T09:30:00Z'],
  ['Santiago midnight gap -> pre-jump', '2027-09-05', '00:00:00', 'America/Santiago', '2027-09-05T04:00:00Z'],
  ['Kolkata +05:30 ordinary', '2027-01-15', '08:00:00', 'Asia/Kolkata', '2027-01-15T02:30:00Z'],
  ['UTC ordinary', '2027-01-15', '23:30:00', 'UTC', '2027-01-15T23:30:00Z'],
  ['24:00 is next midnight (Postgres TIME)', '2027-01-15', '24:00:00', 'America/Denver', '2027-01-16T07:00:00Z'],
];

describe('wallTimeToInstant matches Postgres `timestamp AT TIME ZONE`', () => {
  it.each(PG)('%s', (_why, date, time, zone, pg) => {
    expect(wallTimeToInstant(date, time, zone).toISOString()).toBe(new Date(pg).toISOString());
  });

  it('accepts HH:MM as well as HH:MM:SS', () => {
    expect(wallTimeToInstant('2027-03-14', '02:30', 'America/New_York').toISOString()).toBe(
      '2027-03-14T07:30:00.000Z'
    );
  });

  it('answers Invalid Date (never throws) for junk input or an unknown zone', () => {
    expect(Number.isNaN(wallTimeToInstant('2027-03-14', '02:30', 'Mars/Olympus').getTime())).toBe(true);
    expect(Number.isNaN(wallTimeToInstant('not-a-day', '02:30', 'UTC').getTime())).toBe(true);
    expect(Number.isNaN(wallTimeToInstant('2027-03-14', 'noon', 'UTC').getTime())).toBe(true);
  });
});
