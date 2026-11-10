import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from 'i18next';
import { formatEventTimeForDisplay } from '../timezone';

/**
 * SCENARIO — "Juan" on the web: the owner-set circle zone as a browser in New
 * York and a browser in Monterrey render it. Twin of mobile's
 * `src/__tests__/components/CircleTimezoneJuanScenario.test.tsx`; SAME table,
 * same strings (copied verbatim, so a drift between the platforms fails one side).
 *
 * Juan (owner) is in Connecticut; his parents (no account) in Monterrey; the
 * circle zone is America/Monterrey. Mexico has no DST since Oct 2022, New York
 * does: the gap is 1 h in US winter, 2 h from 2027-03-14 to 2027-11-07. The
 * zone-change scenarios also put the circle on London, Sydney and Phoenix.
 *
 * The viewer zone is pinned through `resolvedOptions` (only getDeviceTimezone
 * reads it), so both devices are exercised in one run under any process TZ.
 */
let viewerZone = 'America/New_York';
const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
  this: Intl.DateTimeFormat
) {
  return { ...realResolved.call(this), timeZone: viewerZone };
});

const lang = i18n as unknown as { language?: string; resolvedLanguage?: string };
const ORIGINAL_LANGUAGE = lang.language;

const NY = 'America/New_York';
const MTY = 'America/Monterrey';
const LON = 'Europe/London';
const SYD = 'Australia/Sydney';
const PHX = 'America/Phoenix';

type Row = { why: string; circle: string; date: string; time: string; onNY: string; onMTY: string };

const ROWS: Row[] = [
  // --- Juan: Monterrey circle -------------------------------------------------
  { why: 'US winter (1 h gap)', circle: MTY, date: '2026-11-16', time: '20:00', onNY: '8:00 PM (Monterrey) / 9:00 PM (New York)', onMTY: '8:00 PM' },
  { why: 'US summer (2 h gap)', circle: MTY, date: '2027-07-15', time: '20:00', onNY: '8:00 PM (Monterrey) / 10:00 PM (New York)', onMTY: '8:00 PM' },
  { why: 'day before US spring-forward', circle: MTY, date: '2027-03-13', time: '20:00', onNY: '8:00 PM (Monterrey) / 9:00 PM (New York)', onMTY: '8:00 PM' },
  { why: 'US spring-forward day', circle: MTY, date: '2027-03-14', time: '20:00', onNY: '8:00 PM (Monterrey) / 10:00 PM (New York)', onMTY: '8:00 PM' },
  { why: 'day before US fall-back', circle: MTY, date: '2027-11-06', time: '20:00', onNY: '8:00 PM (Monterrey) / 10:00 PM (New York)', onMTY: '8:00 PM' },
  { why: 'US fall-back day', circle: MTY, date: '2027-11-07', time: '20:00', onNY: '8:00 PM (Monterrey) / 9:00 PM (New York)', onMTY: '8:00 PM' },
  // the 23:30 dose: the NY half lands on the NEXT day and names it
  { why: '23:30 Mon, winter -> Tue 00:30 ET', circle: MTY, date: '2026-11-16', time: '23:30', onNY: '11:30 PM (Monterrey) / Tue 12:30 AM (New York)', onMTY: '11:30 PM' },
  { why: '23:30 Thu, summer -> Fri 01:30 ET', circle: MTY, date: '2027-07-15', time: '23:30', onNY: '11:30 PM (Monterrey) / Fri 1:30 AM (New York)', onMTY: '11:30 PM' },
  { why: '23:30 Sat before spring-forward -> Sun 00:30 EST', circle: MTY, date: '2027-03-13', time: '23:30', onNY: '11:30 PM (Monterrey) / Sun 12:30 AM (New York)', onMTY: '11:30 PM' },
  { why: '23:30 on spring-forward Sun -> Mon 01:30 EDT', circle: MTY, date: '2027-03-14', time: '23:30', onNY: '11:30 PM (Monterrey) / Mon 1:30 AM (New York)', onMTY: '11:30 PM' },
  { why: '23:30 Sat before fall-back -> Sun 01:30 (first, EDT)', circle: MTY, date: '2027-11-06', time: '23:30', onNY: '11:30 PM (Monterrey) / Sun 1:30 AM (New York)', onMTY: '11:30 PM' },
  // --- case b / f: the circle on New York, seen from Monterrey -----------------
  { why: 'NY circle, before US spring-forward', circle: NY, date: '2027-03-13', time: '20:00', onNY: '8:00 PM', onMTY: '8:00 PM (New York) / 7:00 PM (Monterrey)' },
  { why: 'NY circle, after US spring-forward', circle: NY, date: '2027-03-15', time: '20:00', onNY: '8:00 PM', onMTY: '8:00 PM (New York) / 6:00 PM (Monterrey)' },
  { why: 'NY circle, before US fall-back', circle: NY, date: '2027-11-06', time: '20:00', onNY: '8:00 PM', onMTY: '8:00 PM (New York) / 6:00 PM (Monterrey)' },
  { why: 'NY circle, after US fall-back', circle: NY, date: '2027-11-08', time: '20:00', onNY: '8:00 PM', onMTY: '8:00 PM (New York) / 7:00 PM (Monterrey)' },
  // --- case e: London; the US-vs-EU mismatch windows ---------------------------
  { why: 'London GMT, US already EDT (mismatch, Mar)', circle: LON, date: '2027-03-20', time: '20:00', onNY: '8:00 PM (London) / 4:00 PM (New York)', onMTY: '8:00 PM (London) / 2:00 PM (Monterrey)' },
  { why: 'London BST after 03-28', circle: LON, date: '2027-03-30', time: '20:00', onNY: '8:00 PM (London) / 3:00 PM (New York)', onMTY: '8:00 PM (London) / 1:00 PM (Monterrey)' },
  { why: 'London BST before 10-31', circle: LON, date: '2027-10-27', time: '20:00', onNY: '8:00 PM (London) / 3:00 PM (New York)', onMTY: '8:00 PM (London) / 1:00 PM (Monterrey)' },
  { why: 'London GMT, US still EDT (mismatch, Nov)', circle: LON, date: '2027-11-03', time: '20:00', onNY: '8:00 PM (London) / 4:00 PM (New York)', onMTY: '8:00 PM (London) / 2:00 PM (Monterrey)' },
  { why: 'London GMT, US EST after 11-07', circle: LON, date: '2027-11-08', time: '20:00', onNY: '8:00 PM (London) / 3:00 PM (New York)', onMTY: '8:00 PM (London) / 2:00 PM (Monterrey)' },
  // --- case h: Sydney (opposite season) ----------------------------------------
  { why: 'Sydney AEDT, before its 04-04 fall-back', circle: SYD, date: '2027-04-01', time: '20:00', onNY: '8:00 PM (Sydney) / 5:00 AM (New York)', onMTY: '8:00 PM (Sydney) / 3:00 AM (Monterrey)' },
  { why: 'Sydney AEST, after its fall-back', circle: SYD, date: '2027-04-07', time: '20:00', onNY: '8:00 PM (Sydney) / 6:00 AM (New York)', onMTY: '8:00 PM (Sydney) / 4:00 AM (Monterrey)' },
  { why: 'Sydney 08:00 Tue -> Mon evening in NY', circle: SYD, date: '2027-10-05', time: '08:00', onNY: '8:00 AM (Sydney) / Mon 5:00 PM (New York)', onMTY: '8:00 AM (Sydney) / Mon 3:00 PM (Monterrey)' },
  // --- case g: Phoenix (no DST) -------------------------------------------------
  { why: 'Phoenix vs NY EST', circle: PHX, date: '2027-03-12', time: '20:00', onNY: '8:00 PM (Phoenix) / 10:00 PM (New York)', onMTY: '8:00 PM (Phoenix) / 9:00 PM (Monterrey)' },
  { why: 'Phoenix vs NY EDT', circle: PHX, date: '2027-03-15', time: '20:00', onNY: '8:00 PM (Phoenix) / 11:00 PM (New York)', onMTY: '8:00 PM (Phoenix) / 9:00 PM (Monterrey)' },
];

const dual = (r: Row) => formatEventTimeForDisplay(`${r.time}:00`, r.circle, undefined, r.date, '12h');

beforeEach(() => {
  lang.language = 'en';
  delete lang.resolvedLanguage;
});
afterEach(() => {
  viewerZone = NY;
});
afterAll(() => {
  lang.language = ORIGINAL_LANGUAGE;
});

describe('Juan scenario on the web', () => {
  it.each(ROWS)('New York browser: $circle $date $time ($why)', (r) => {
    viewerZone = NY;
    expect(dual(r)).toBe(r.onNY);
  });

  it.each(ROWS)('Monterrey browser: $circle $date $time ($why)', (r) => {
    viewerZone = MTY;
    expect(dual(r)).toBe(r.onMTY);
  });

  it('the gap is 1 h / 2 h / 1 h across the two US switches for the same 20:00 Monterrey dose', () => {
    viewerZone = NY;
    const viewer = (date: string) =>
      dual({ why: '', circle: MTY, date, time: '20:00', onNY: '', onMTY: '' }).split(' / ')[1];
    expect(['2027-03-13', '2027-03-14', '2027-11-06', '2027-11-07'].map(viewer)).toEqual([
      '9:00 PM (New York)',
      '10:00 PM (New York)',
      '10:00 PM (New York)',
      '9:00 PM (New York)',
    ]);
  });
});

// ---------------------------------------------------------------------------
// DST-hostile dose times (twin of the mobile block). The cron resolves a
// REPEATED wall time to its SECOND occurrence and a MISSING one with the
// pre-jump offset. FIXED 2026-11-09: holes used to render one hour EARLIER
// than the reminder fires; the formatter now resolves through
// `wallTimeToInstant`, the Postgres-matching resolver.
// ---------------------------------------------------------------------------
const HOSTILE = [
  { why: 'NY repeated 01:30', circle: NY, date: '2027-11-07', time: '01:30', cronDue: '2027-11-07T06:30:00Z', hole: false },
  { why: 'NY missing 02:30', circle: NY, date: '2027-03-14', time: '02:30', cronDue: '2027-03-14T07:30:00Z', hole: true },
  { why: 'London repeated 01:30', circle: LON, date: '2027-10-31', time: '01:30', cronDue: '2027-10-31T01:30:00Z', hole: false },
  { why: 'London missing 01:30', circle: LON, date: '2027-03-28', time: '01:30', cronDue: '2027-03-28T01:30:00Z', hole: true },
  { why: 'Sydney repeated 02:30', circle: SYD, date: '2027-04-04', time: '02:30', cronDue: '2027-04-03T16:30:00Z', hole: false },
  { why: 'Sydney missing 02:30', circle: SYD, date: '2027-10-03', time: '02:30', cronDue: '2027-10-02T16:30:00Z', hole: true },
];
const LABEL: Record<string, string> = { [NY]: 'New York', [MTY]: 'Monterrey', [LON]: 'London', [SYD]: 'Sydney' };
const clock12 = (zone: string, at: Date) =>
  new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(at)
    .replace(/ /g, ' ');

describe('DST-hostile dose times: the viewer half names the reminder instant', () => {
  for (const viewer of [MTY, NY]) {
    for (const h of HOSTILE) {
      if (viewer === h.circle) continue;
      const due = new Date(h.cronDue);
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: viewer }).format(due);
      const wd = day === h.date ? '' : `${new Intl.DateTimeFormat('en-US', { timeZone: viewer, weekday: 'short' }).format(due)} `;
      const own = `${Number(h.time.slice(0, 2)) % 12 || 12}:${h.time.slice(3)} AM`;
      const want = `${own} (${LABEL[h.circle]}) / ${wd}${clock12(viewer, due)} (${LABEL[viewer]})`;
      it(`${viewer} browser, ${h.why}`, () => {
        viewerZone = viewer;
        expect(formatEventTimeForDisplay(`${h.time}:00`, h.circle, undefined, h.date, '12h')).toBe(want);
      });
    }
  }
});
