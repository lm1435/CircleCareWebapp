import { describe, it, expect } from 'vitest';
import '@/i18n'; // real bootstrap: changeLanguage must be a live call, not a no-op
import i18n from 'i18next';
import { clockInZone, dayInZone, eventDatesForApi, eventDatesFromApi } from '../recipientEventDate';
import { formatDateTimeForAPI, formatTimeForAPI, getDateInTimezone } from '../timezone';
import {
  recipientWallTimeToUtcISO,
  utcISOToRecipientWallTime,
} from '@/components/vitals/vitalDateTime';

/**
 * NO DISPLAY LOCALE MAY REACH WIRE FORMATTING.
 *
 * A locale carries a CALENDAR and a NUMBERING SYSTEM, and both leak into
 * `Intl.DateTimeFormat` output:
 *
 *   en-US                        2026-09-02  02:00
 *   en-SA-u-ca-islamic-umalqura  1448-03-20  02:00
 *   ar-EG-u-nu-arab              ٢٠٢٦-٠٩-٠٢  ٠٢:٠٠     <- the TIME too
 *
 * mobile-63 hit the date case, then found the time case as well. The webapp is
 * immune by construction — every wire formatter pins its own locale and the
 * conversion module takes no locale parameter at all — and this file is what
 * keeps it that way. Threading `i18n.language` into any of these functions
 * turns these tests red.
 *
 * The first block deliberately proves the THREAT is real on this runtime.
 * Without it, the assertions below could pass on a machine where the corrupting
 * locales are unavailable and the whole file would be theatre.
 */

const CORRUPTING = ['en-SA-u-ca-islamic-umalqura', 'ar-EG-u-nu-arab', 'th-TH-u-ca-buddhist'];
const AT = new Date('2026-09-02T02:00:00Z');

/** Strict wire shapes: Latin digits only, Gregorian range, 24-hour clock. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ISO_CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const LATIN_ONLY = /^[\d\-:.TZ]+$/;

/**
 * Does `locale` actually CORRUPT a formatted date/time?
 *
 * Detects the two real pathologies, NOT the format. The first version of this
 * helper asked "is the output ISO-shaped", which `en-US` ("09/02/2026") fails
 * — so it reported every locale as corrupt and the inverted guard below passed
 * unconditionally. It was inert: the exact failure it exists to catch.
 * (Caught by mobile-63, who shipped the same mistake independently.)
 *
 *   1. A NON-GREGORIAN YEAR. Hijri 1448, Buddhist 2569. This is the dangerous
 *      one: a four-digit year that a DATE column accepts without complaint.
 *   2. NON-LATIN DIGITS. Arabic-Indic ٢٠٢٦. Bidi marks (U+200E/U+200F) are
 *      stripped first — they are direction hints, not digits, and appear
 *      around otherwise-Latin output.
 */
function corrupts(locale: string): boolean {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(AT);

  const year = Number(parts.find((p) => p.type === 'year')?.value);
  if (!Number.isFinite(year) || Math.abs(year - 2026) > 1) return true;

  const digits = parts
    .filter((p) => p.type !== 'literal')
    .map((p) => p.value)
    .join('')
    .replace(/[\u200e\u200f]/g, '');
  return /[^\x00-\x7F]/.test(digits);
}

describe('the threat is real on this runtime', () => {
  it('flags every corrupting locale', () => {
    const missed = CORRUPTING.filter((l) => !corrupts(l));
    // Inverted on purpose: if this runtime resolves these locales to something
    // benign, the guards below have stopped testing anything and must say so
    // rather than going quietly green.
    expect(missed).toEqual([]);
  });

  /**
   * THE NEGATIVE TEST — the one that would have caught the inert version.
   *
   * An inverted guard needs its own negative case, or it is just another way to
   * be green for free. `en-US` renders "09/02/2026" and `en-GB` "02/09/2026";
   * neither is ISO-shaped and neither is corrupt, and a detector that cannot
   * tell those apart proves nothing about the locales that ARE.
   */
  it('does NOT flag an ordinary locale', () => {
    const falsePositives = ['en-US', 'en-GB', 'en-CA', 'es-MX', 'de-DE'].filter(corrupts);
    expect(falsePositives).toEqual([]);
  });
});

describe('wire formatters ignore the display language entirely', () => {
  const ZONES = [
    'America/Chicago',
    'Asia/Tokyo',
    'Pacific/Kiritimati',
    'Asia/Kathmandu',
    'America/St_Johns',
  ];

  // These functions read no locale, so switching the app's language must not
  // change a single byte. Asserted rather than assumed: it is exactly the
  // property a future "let's respect the user's locale" change would break.
  const languages = ['en', 'es', 'ar-EG-u-nu-arab', 'en-SA-u-ca-islamic-umalqura'];

  it('produces byte-identical output under every display language', async () => {
    const original = i18n.language;
    const seen = new Map<string, string>();
    try {
      for (const lng of languages) {
        await i18n.changeLanguage(lng);
        for (const zone of ZONES) {
          const out = eventDatesForApi({
            dateStr: '2026-09-02',
            timeStr: '02:00',
            recurrenceEndDateStr: '2026-10-01',
            timezone: zone,
          });
          const key = zone;
          const value = `${out.scheduledDate}|${out.scheduledTime}|${out.recurrenceEndDate}`;
          const prior = seen.get(key);
          if (prior === undefined) seen.set(key, value);
          else expect(`${lng} ${zone}: ${value}`).toBe(`${lng} ${zone}: ${prior}`);
        }
      }
    } finally {
      await i18n.changeLanguage(original);
    }
  });

  it('emits strict ISO from every wire producer', () => {
    const bad: string[] = [];
    for (const zone of ZONES) {
      const day = dayInZone(AT, zone);
      const clock = clockInZone(AT, zone);
      if (!ISO_DAY.test(day)) bad.push(`dayInZone(${zone}) = ${day}`);
      if (!ISO_CLOCK.test(clock)) bad.push(`clockInZone(${zone}) = ${clock}`);

      if (!ISO_DAY.test(getDateInTimezone(zone, AT))) {
        bad.push(`getDateInTimezone(${zone}) = ${getDateInTimezone(zone, AT)}`);
      }
      if (!ISO_CLOCK.test(formatTimeForAPI(AT, zone))) {
        bad.push(`formatTimeForAPI(${zone}) = ${formatTimeForAPI(AT, zone)}`);
      }

      const both = formatDateTimeForAPI(AT, zone);
      if (!ISO_DAY.test(both.scheduled_date) || !ISO_CLOCK.test(both.scheduled_time)) {
        bad.push(`formatDateTimeForAPI(${zone}) = ${both.scheduled_date} ${both.scheduled_time}`);
      }

      const forApi = eventDatesForApi({
        dateStr: '2026-09-02',
        timeStr: '02:00',
        recurrenceEndDateStr: '2026-10-01',
        timezone: zone,
      });
      if (
        !ISO_DAY.test(forApi.scheduledDate) ||
        !ISO_CLOCK.test(forApi.scheduledTime as string) ||
        !ISO_DAY.test(forApi.recurrenceEndDate as string)
      ) {
        bad.push(`eventDatesForApi(${zone}) = ${JSON.stringify(forApi)}`);
      }

      // The hydration side feeds <input type="date"> / <input type="time">,
      // which only accept these same shapes.
      const fromApi = eventDatesFromApi({
        scheduledDate: '2026-09-02',
        scheduledTime: '02:00',
        recurrenceEndDate: '2026-10-01',
        timezone: zone,
      });
      if (!ISO_DAY.test(fromApi.dateStr) || !ISO_CLOCK.test(fromApi.timeStr)) {
        bad.push(`eventDatesFromApi(${zone}) = ${JSON.stringify(fromApi)}`);
      }

      // Vitals writes an instant rather than naive values, but the same rule
      // applies to the wall-clock pair it round-trips through.
      const wall = utcISOToRecipientWallTime(AT.toISOString(), zone);
      if (!ISO_DAY.test(wall.date) || !ISO_CLOCK.test(wall.time)) {
        bad.push(`utcISOToRecipientWallTime(${zone}) = ${wall.date} ${wall.time}`);
      }
      const iso = recipientWallTimeToUtcISO(wall.date, wall.time, zone);
      if (!LATIN_ONLY.test(iso.replace(/[^\d\-:.TZ]/g, 'X'))) {
        bad.push(`recipientWallTimeToUtcISO(${zone}) = ${iso}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('never emits a year outside the Gregorian range the backend stores', () => {
    // The Hijri case is not merely "differently formatted" — 1448 is a valid
    // four-digit year that a DATE column accepts without complaint.
    for (const zone of ['America/Chicago', 'Pacific/Kiritimati']) {
      const year = Number(dayInZone(AT, zone).slice(0, 4));
      expect(year).toBeGreaterThan(2000);
      expect(year).toBeLessThan(2100);
    }
  });
});
