/**
 * ONE TABLE PER CROSS-ZONE CASE, ONE ROW PER SWEEP ZONE (web copy; the mobile twin is
 * mobile/src/__tests__/helpers/zoneTables.ts and holds the SAME rows).
 *
 * The BC-1 / BC-3 / BC-8 / date-frame suites run under the process zone (the viewer) and look up "a circle in
 * another zone" for it. Each suite used to keep its own table for the six zones the DST spec named, so when the
 * shared sweep list (CircleCare/scripts/timezones.txt) grew to 34 zones every other zone threw "Add <zone> to the
 * table" — 7 failures in 3 suites (and 15 on mobile) in 28 zones, invisible to a plain `npx vitest run` under Denver.
 *
 * Now: the rows live here, and utils/__tests__/zoneTablesCoverSweep.test.ts checks in EVERY zone (a plain run included)
 * that every sweep zone has a row in every table and that each row still is the case it is for (Intl oracle only).
 * A zone added to timezones.txt fails that test until it gets rows here.
 *
 * The six hand-picked rows of the DST spec (Denver, UTC, New York, London, Auckland, Kolkata) are kept as they
 * were; the rest were chosen by an Intl search with the criterion each table states.
 */

/** The shared sweep list (scripts/timezones.txt), canonical spellings; the coverage test pins the two together. */
export const SWEEP_ZONES = [
  'America/Denver',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Phoenix',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/St_Johns',
  'America/Puerto_Rico',
  'America/Sao_Paulo',
  'America/Santiago',
  'America/Mexico_City',
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Kyiv',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Asia/Tehran',
  'Asia/Jerusalem',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Australia/Adelaide',
  'Australia/Lord_Howe',
  'Pacific/Auckland',
  'Pacific/Chatham',
  'Pacific/Kiritimati',
  'Pacific/Apia',
  'Pacific/Midway',
] as const;

/** The process zone with ICU's legacy alias spellings folded to the list's. */
export function ambientZone(): string {
  return foldZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** ICU's legacy spelling of a zone -> the sweep list's (Asia/Calcutta, Europe/Kiev, Asia/Katmandu, Etc/UTC). */
export function foldZone(z: string): string {
  return (
    {
      'Asia/Calcutta': 'Asia/Kolkata',
      'Europe/Kiev': 'Europe/Kyiv',
      'Asia/Katmandu': 'Asia/Kathmandu',
      'Etc/UTC': 'UTC',
      'Etc/GMT': 'UTC',
    } as Record<string, string>
  )[z] ?? z;
}

export type GateRow = { circle: string; date: string; time: string; shown: boolean };

/**
 * BC-1 (extra dose on the primary's circle day): the primary at 08:00 and the extra (`18:00` Evening / `21:00`
 * Bedtime chip) on the circle's day are on DIFFERENT viewer days — on 2026-11-12 and on the circle's day at
 * 2027-02-10T18:40Z — and the circle's day at 2026-11-12T12:00Z is 2026-11-12 (the web form's clock).
 */
export const BC1: Record<string, { circle: string; extra: '18:00' | '21:00' }> = {
  'America/Denver': { circle: 'Asia/Tokyo', extra: '21:00' },
  'America/New_York': { circle: 'America/Los_Angeles', extra: '21:00' },
  'America/Chicago': { circle: 'Asia/Tokyo', extra: '18:00' },
  'America/Los_Angeles': { circle: 'Asia/Tokyo', extra: '18:00' },
  'America/Phoenix': { circle: 'Asia/Tokyo', extra: '18:00' },
  'Pacific/Honolulu': { circle: 'Asia/Tokyo', extra: '21:00' },
  'America/Anchorage': { circle: 'Asia/Tokyo', extra: '18:00' },
  'America/St_Johns': { circle: 'Asia/Tokyo', extra: '18:00' },
  'America/Puerto_Rico': { circle: 'Asia/Tokyo', extra: '18:00' },
  'America/Sao_Paulo': { circle: 'Asia/Tokyo', extra: '18:00' },
  'America/Santiago': { circle: 'Asia/Tokyo', extra: '18:00' },
  'America/Mexico_City': { circle: 'Asia/Tokyo', extra: '18:00' },
  UTC: { circle: 'America/Denver', extra: '18:00' },
  'Europe/London': { circle: 'America/Denver', extra: '18:00' },
  'Europe/Berlin': { circle: 'America/Denver', extra: '18:00' },
  'Europe/Kyiv': { circle: 'America/Denver', extra: '18:00' },
  'Africa/Cairo': { circle: 'America/Denver', extra: '18:00' },
  'Africa/Casablanca': { circle: 'Asia/Tokyo', extra: '18:00' },
  'Asia/Tehran': { circle: 'America/Denver', extra: '18:00' },
  'Asia/Jerusalem': { circle: 'America/Denver', extra: '18:00' },
  'Europe/Moscow': { circle: 'America/Denver', extra: '18:00' },
  'Asia/Dubai': { circle: 'America/Denver', extra: '18:00' },
  'Asia/Kolkata': { circle: 'America/Los_Angeles', extra: '21:00' },
  'Asia/Kathmandu': { circle: 'America/Denver', extra: '18:00' },
  'Asia/Shanghai': { circle: 'America/Denver', extra: '18:00' },
  'Asia/Tokyo': { circle: 'Europe/London', extra: '18:00' },
  'Australia/Sydney': { circle: 'Europe/London', extra: '18:00' },
  'Australia/Adelaide': { circle: 'Europe/London', extra: '18:00' },
  'Australia/Lord_Howe': { circle: 'Europe/London', extra: '18:00' },
  'Pacific/Auckland': { circle: 'Europe/London', extra: '18:00' },
  'Pacific/Chatham': { circle: 'Asia/Tokyo', extra: '21:00' },
  'Pacific/Kiritimati': { circle: 'Asia/Tokyo', extra: '21:00' },
  'Pacific/Apia': { circle: 'Asia/Tokyo', extra: '21:00' },
  'Pacific/Midway': { circle: 'Asia/Tokyo', extra: '21:00' },
};

/**
 * BC-8 (a preset / chip means the circle's clock): a circle whose clock differs from the viewer's at 08:00, 18:00,
 * 20:00 and 21:00 on 2026-11-12 and on its day at 2027-02-10T18:40Z; its day at 2026-11-12T12:00Z is 2026-11-12.
 */
export const BC8: Record<string, string> = {
  'America/Denver': 'America/New_York',
  'America/New_York': 'America/Denver',
  'America/Chicago': 'Asia/Tokyo',
  'America/Los_Angeles': 'Asia/Tokyo',
  'America/Phoenix': 'Asia/Tokyo',
  'Pacific/Honolulu': 'Asia/Tokyo',
  'America/Anchorage': 'Asia/Tokyo',
  'America/St_Johns': 'Asia/Tokyo',
  'America/Puerto_Rico': 'Asia/Tokyo',
  'America/Sao_Paulo': 'Asia/Tokyo',
  'America/Santiago': 'Asia/Tokyo',
  'America/Mexico_City': 'Asia/Tokyo',
  UTC: 'America/Denver',
  'Europe/London': 'America/Denver',
  'Europe/Berlin': 'Asia/Tokyo',
  'Europe/Kyiv': 'Asia/Tokyo',
  'Africa/Cairo': 'Asia/Tokyo',
  'Africa/Casablanca': 'Asia/Tokyo',
  'Asia/Tehran': 'Asia/Tokyo',
  'Asia/Jerusalem': 'Asia/Tokyo',
  'Europe/Moscow': 'Asia/Tokyo',
  'Asia/Dubai': 'Asia/Tokyo',
  'Asia/Kolkata': 'America/Los_Angeles',
  'Asia/Kathmandu': 'Asia/Tokyo',
  'Asia/Shanghai': 'Asia/Tokyo',
  'Asia/Tokyo': 'America/Denver',
  'Australia/Sydney': 'Asia/Tokyo',
  'Australia/Adelaide': 'Asia/Tokyo',
  'Australia/Lord_Howe': 'Asia/Tokyo',
  'Pacific/Auckland': 'America/Denver',
  'Pacific/Chatham': 'Asia/Tokyo',
  'Pacific/Kiritimati': 'Asia/Tokyo',
  'Pacific/Apia': 'Asia/Tokyo',
  'Pacific/Midway': 'Asia/Tokyo',
};

/**
 * BC-3 (the zone caption is judged at the event instant): two rows per viewer, device date + device clock -> shown.
 * Where a zone changes clocks to or from the viewer's offset in 2026, the pair sits on that day and one row's answer
 * is the OPPOSITE of the answer at device midnight (what mobile used to judge). For a viewer no zone does that for
 * (St John's, Tehran, Dubai, Kolkata, Kathmandu, Shanghai, Tokyo, Chatham, Kiritimati, Midway) the pair is one other
 * clock and, where one exists, one zone on the same clock.
 */
export const GATE: Record<string, [GateRow, GateRow]> = {
  'America/Denver': [
    { circle: 'America/Phoenix', date: '2026-03-08', time: '10:00', shown: true },
    { circle: 'America/Phoenix', date: '2026-03-08', time: '01:00', shown: false },
  ],
  'America/New_York': [
    { circle: 'America/Bogota', date: '2026-11-01', time: '10:00', shown: false },
    { circle: 'America/Bogota', date: '2026-11-01', time: '00:30', shown: true },
  ],
  'America/Chicago': [
    { circle: 'America/Regina', date: '2026-03-08', time: '10:00', shown: true },
    { circle: 'America/Regina', date: '2026-03-08', time: '00:30', shown: false },
  ],
  'America/Los_Angeles': [
    { circle: 'America/Phoenix', date: '2026-03-08', time: '10:00', shown: false },
    { circle: 'America/Phoenix', date: '2026-03-08', time: '00:30', shown: true },
  ],
  'America/Phoenix': [
    { circle: 'America/Denver', date: '2026-03-08', time: '10:00', shown: true },
    { circle: 'America/Denver', date: '2026-03-08', time: '00:30', shown: false },
  ],
  'Pacific/Honolulu': [
    { circle: 'America/Adak', date: '2026-03-08', time: '10:00', shown: true },
    { circle: 'America/Adak', date: '2026-03-08', time: '00:30', shown: false },
  ],
  'America/Anchorage': [
    { circle: 'Pacific/Gambier', date: '2026-03-08', time: '10:00', shown: true },
    { circle: 'Pacific/Gambier', date: '2026-03-08', time: '00:30', shown: false },
  ],
  'America/St_Johns': [
    { circle: 'America/Los_Angeles', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Asia/Tokyo', date: '2026-06-10', time: '00:30', shown: true },
  ],
  'America/Puerto_Rico': [
    { circle: 'America/New_York', date: '2026-03-08', time: '10:00', shown: false },
    { circle: 'America/New_York', date: '2026-03-08', time: '00:30', shown: true },
  ],
  'America/Sao_Paulo': [
    { circle: 'America/Glace_Bay', date: '2026-03-08', time: '10:00', shown: false },
    { circle: 'America/Glace_Bay', date: '2026-03-08', time: '00:30', shown: true },
  ],
  'America/Santiago': [
    { circle: 'America/Glace_Bay', date: '2026-03-08', time: '10:00', shown: false },
    { circle: 'America/Glace_Bay', date: '2026-03-08', time: '00:30', shown: true },
  ],
  'America/Mexico_City': [
    { circle: 'America/Denver', date: '2026-03-08', time: '10:00', shown: false },
    { circle: 'America/Denver', date: '2026-03-08', time: '00:30', shown: true },
  ],
  UTC: [
    { circle: 'Europe/London', date: '2026-03-29', time: '10:00', shown: true },
    { circle: 'Europe/London', date: '2026-03-29', time: '00:30', shown: false },
  ],
  'Europe/London': [
    { circle: 'Africa/Abidjan', date: '2026-03-29', time: '10:00', shown: true },
    { circle: 'Africa/Abidjan', date: '2026-03-29', time: '00:30', shown: false },
  ],
  'Europe/Berlin': [
    { circle: 'Africa/Algiers', date: '2026-03-29', time: '10:00', shown: true },
    { circle: 'Africa/Algiers', date: '2026-03-29', time: '00:30', shown: false },
  ],
  'Europe/Kyiv': [
    { circle: 'Africa/Addis_Ababa', date: '2026-03-29', time: '10:00', shown: false },
    { circle: 'Africa/Addis_Ababa', date: '2026-03-29', time: '00:30', shown: true },
  ],
  'Africa/Cairo': [
    { circle: 'Europe/Berlin', date: '2026-03-29', time: '10:00', shown: false },
    { circle: 'Europe/Berlin', date: '2026-03-29', time: '00:30', shown: true },
  ],
  'Africa/Casablanca': [
    { circle: 'Europe/London', date: '2026-02-15', time: '10:00', shown: false },
    { circle: 'Europe/London', date: '2026-02-15', time: '00:30', shown: true },
  ],
  'Asia/Tehran': [
    { circle: 'America/Denver', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Asia/Tokyo', date: '2026-06-10', time: '00:30', shown: true },
  ],
  'Asia/Jerusalem': [
    { circle: 'Africa/Addis_Ababa', date: '2026-03-27', time: '10:00', shown: false },
    { circle: 'Africa/Addis_Ababa', date: '2026-03-27', time: '00:30', shown: true },
  ],
  'Europe/Moscow': [
    { circle: 'Africa/Cairo', date: '2026-04-24', time: '10:00', shown: false },
    { circle: 'Africa/Cairo', date: '2026-04-24', time: '00:30', shown: true },
  ],
  'Asia/Dubai': [
    { circle: 'America/Denver', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Asia/Baku', date: '2026-06-10', time: '00:30', shown: false },
  ],
  'Asia/Kolkata': [
    { circle: 'America/Denver', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Asia/Calcutta', date: '2026-06-10', time: '00:30', shown: false },
  ],
  'Asia/Kathmandu': [
    { circle: 'America/Denver', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Asia/Katmandu', date: '2026-06-10', time: '00:30', shown: false },
  ],
  'Asia/Shanghai': [
    { circle: 'America/Denver', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Antarctica/Casey', date: '2026-06-10', time: '00:30', shown: false },
  ],
  'Asia/Tokyo': [
    { circle: 'America/Denver', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Asia/Chita', date: '2026-06-10', time: '00:30', shown: false },
  ],
  'Australia/Sydney': [
    { circle: 'Antarctica/DumontDUrville', date: '2026-04-05', time: '10:00', shown: false },
    { circle: 'Antarctica/DumontDUrville', date: '2026-04-05', time: '00:30', shown: true },
  ],
  'Australia/Adelaide': [
    { circle: 'Australia/Darwin', date: '2026-04-05', time: '10:00', shown: false },
    { circle: 'Australia/Darwin', date: '2026-04-05', time: '00:30', shown: true },
  ],
  'Australia/Lord_Howe': [
    { circle: 'Australia/Sydney', date: '2026-04-05', time: '10:00', shown: true },
    { circle: 'Australia/Sydney', date: '2026-04-05', time: '00:30', shown: false },
  ],
  'Pacific/Auckland': [
    { circle: 'Pacific/Fiji', date: '2026-04-05', time: '10:00', shown: false },
    { circle: 'Pacific/Fiji', date: '2026-04-05', time: '00:30', shown: true },
  ],
  'Pacific/Chatham': [
    { circle: 'Asia/Tokyo', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'America/Denver', date: '2026-06-10', time: '00:30', shown: true },
  ],
  'Pacific/Kiritimati': [
    { circle: 'Asia/Tokyo', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'America/Denver', date: '2026-06-10', time: '00:30', shown: true },
  ],
  'Pacific/Apia': [
    { circle: 'Pacific/Auckland', date: '2026-04-05', time: '10:00', shown: true },
    { circle: 'Pacific/Auckland', date: '2026-04-05', time: '00:30', shown: false },
  ],
  'Pacific/Midway': [
    { circle: 'Asia/Tokyo', date: '2026-06-10', time: '10:00', shown: true },
    { circle: 'Pacific/Niue', date: '2026-06-10', time: '00:30', shown: false },
  ],
};

/** Date-frame guard: two circles per viewer, each at least 3 h from the viewer at every instant the guard uses. */
export const DATE_FRAME_PAIRS: Record<string, [string, string]> = {
  'America/Denver': ['Asia/Tokyo', 'Pacific/Kiritimati'],
  'America/New_York': ['Europe/London', 'Pacific/Honolulu'],
  'America/Chicago': ['Asia/Tokyo', 'Pacific/Honolulu'],
  'America/Los_Angeles': ['Asia/Tokyo', 'Pacific/Pago_Pago'],
  'America/Phoenix': ['Asia/Tokyo', 'Pacific/Honolulu'],
  'Pacific/Honolulu': ['Asia/Tokyo', 'America/Denver'],
  'America/Anchorage': ['Asia/Tokyo', 'Europe/London'],
  'America/St_Johns': ['Asia/Tokyo', 'America/Los_Angeles'],
  'America/Puerto_Rico': ['Asia/Tokyo', 'America/Los_Angeles'],
  'America/Sao_Paulo': ['Asia/Tokyo', 'America/Denver'],
  'America/Santiago': ['Asia/Tokyo', 'America/Los_Angeles'],
  'America/Mexico_City': ['Asia/Tokyo', 'Pacific/Honolulu'],
  UTC: ['Pacific/Pago_Pago', 'Asia/Tokyo'],
  'Europe/London': ['America/Denver', 'Asia/Tokyo'],
  'Europe/Berlin': ['Asia/Tokyo', 'America/Denver'],
  'Europe/Kyiv': ['Asia/Tokyo', 'America/Denver'],
  'Africa/Cairo': ['Asia/Tokyo', 'America/Denver'],
  'Africa/Casablanca': ['Asia/Tokyo', 'America/Denver'],
  'Asia/Tehran': ['Asia/Tokyo', 'America/Denver'],
  'Asia/Jerusalem': ['Asia/Tokyo', 'America/Denver'],
  'Europe/Moscow': ['Asia/Tokyo', 'America/Denver'],
  'Asia/Dubai': ['Asia/Tokyo', 'America/Denver'],
  'Asia/Kolkata': ['Pacific/Kiritimati', 'America/Denver'],
  'Asia/Kathmandu': ['Asia/Tokyo', 'America/Denver'],
  'Asia/Shanghai': ['Pacific/Auckland', 'America/Denver'],
  'Asia/Tokyo': ['Pacific/Auckland', 'America/Denver'],
  'Australia/Sydney': ['Pacific/Kiritimati', 'America/Denver'],
  'Australia/Adelaide': ['Pacific/Kiritimati', 'America/Denver'],
  'Australia/Lord_Howe': ['Pacific/Kiritimati', 'America/Denver'],
  'Pacific/Auckland': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Pacific/Chatham': ['Asia/Tokyo', 'America/Denver'],
  'Pacific/Kiritimati': ['Asia/Tokyo', 'America/Denver'],
  'Pacific/Apia': ['Asia/Tokyo', 'America/Denver'],
  'Pacific/Midway': ['Asia/Tokyo', 'America/Denver'],
};

/** At 2026-11-11T08:14Z the chip's (08:00 morning / 21:00 bedtime) circle day is NOT its viewer day. */
export const RECIPIENT_FRAME_CASES: Record<string, { circle: string; chip: 'morning' | 'bedtime' }> = {
  'America/Denver': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/New_York': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Chicago': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Los_Angeles': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Phoenix': { circle: 'Asia/Tokyo', chip: 'morning' },
  'Pacific/Honolulu': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Anchorage': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/St_Johns': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Puerto_Rico': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Sao_Paulo': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Santiago': { circle: 'Asia/Tokyo', chip: 'morning' },
  'America/Mexico_City': { circle: 'Asia/Tokyo', chip: 'morning' },
  UTC: { circle: 'Pacific/Kiritimati', chip: 'morning' },
  'Europe/London': { circle: 'Pacific/Auckland', chip: 'morning' },
  'Europe/Berlin': { circle: 'America/Denver', chip: 'bedtime' },
  'Europe/Kyiv': { circle: 'America/Denver', chip: 'bedtime' },
  'Africa/Cairo': { circle: 'America/Denver', chip: 'bedtime' },
  'Africa/Casablanca': { circle: 'Asia/Tokyo', chip: 'morning' },
  'Asia/Tehran': { circle: 'America/Denver', chip: 'bedtime' },
  'Asia/Jerusalem': { circle: 'America/Denver', chip: 'bedtime' },
  'Europe/Moscow': { circle: 'America/Denver', chip: 'bedtime' },
  'Asia/Dubai': { circle: 'America/Denver', chip: 'bedtime' },
  'Asia/Kolkata': { circle: 'Pacific/Kiritimati', chip: 'morning' },
  'Asia/Kathmandu': { circle: 'America/Denver', chip: 'bedtime' },
  'Asia/Shanghai': { circle: 'America/Denver', chip: 'bedtime' },
  'Asia/Tokyo': { circle: 'America/Denver', chip: 'morning' },
  'Australia/Sydney': { circle: 'America/Denver', chip: 'morning' },
  'Australia/Adelaide': { circle: 'America/Denver', chip: 'morning' },
  'Australia/Lord_Howe': { circle: 'America/Denver', chip: 'morning' },
  'Pacific/Auckland': { circle: 'Pacific/Pago_Pago', chip: 'bedtime' },
  'Pacific/Chatham': { circle: 'Asia/Tokyo', chip: 'bedtime' },
  'Pacific/Kiritimati': { circle: 'Asia/Tokyo', chip: 'bedtime' },
  'Pacific/Apia': { circle: 'Asia/Tokyo', chip: 'bedtime' },
  'Pacific/Midway': { circle: 'Asia/Tokyo', chip: 'morning' },
};

/** Two far circles per viewer whose clock differs from the viewer's at 08:00 on the circle's day at 2026-11-11T08:14Z. */
export const EXTRA_CLOCK_FAR: Record<string, [string, string]> = {
  'America/Denver': ['Asia/Tokyo', 'Pacific/Kiritimati'],
  'America/New_York': ['Europe/London', 'Asia/Tokyo'],
  'America/Chicago': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'America/Los_Angeles': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'America/Phoenix': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Pacific/Honolulu': ['Asia/Tokyo', 'Pacific/Pago_Pago'],
  'America/Anchorage': ['Asia/Tokyo', 'Pacific/Honolulu'],
  'America/St_Johns': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'America/Puerto_Rico': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'America/Sao_Paulo': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'America/Santiago': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'America/Mexico_City': ['Pacific/Honolulu', 'Asia/Tokyo'],
  UTC: ['Pacific/Kiritimati', 'Pacific/Honolulu'],
  'Europe/London': ['Pacific/Auckland', 'Pacific/Honolulu'],
  'Europe/Berlin': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Europe/Kyiv': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Africa/Cairo': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Africa/Casablanca': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Asia/Tehran': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Asia/Jerusalem': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Europe/Moscow': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Asia/Dubai': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Asia/Kolkata': ['Pacific/Kiritimati', 'Pacific/Honolulu'],
  'Asia/Kathmandu': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Asia/Shanghai': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Asia/Tokyo': ['Pacific/Honolulu', 'America/Denver'],
  'Australia/Sydney': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Australia/Adelaide': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Australia/Lord_Howe': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Pacific/Auckland': ['Pacific/Pago_Pago', 'Pacific/Honolulu'],
  'Pacific/Chatham': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Pacific/Kiritimati': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Pacific/Apia': ['Pacific/Honolulu', 'Asia/Tokyo'],
  'Pacific/Midway': ['Asia/Tokyo', 'Pacific/Honolulu'],
};
