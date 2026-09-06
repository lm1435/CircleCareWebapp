import { describe, it, expect } from 'vitest';
import { formatEventTimeForDisplay, getDeviceTimezone } from '../timezone';
/**
 * THE TWO HALVES OF AN A/B TIME MUST BE THE SAME INSTANT.
 *
 * `formatEventTimeForDisplay` renders "8:00 PM (Denver) / 11:00 AM (Tokyo)" by
 * converting through UTC with two offsets. That arithmetic is where this has
 * broken before: offsets were once folded into +/-12h, which made
 * `timezonesAreDifferent(Kiritimati, Honolulu)` false and, once widened to the
 * real -11..+14 range, exposed a single +/-1440 adjustment that could not span
 * the true [-1500, 2939] minute range.
 *
 * So this does not assert a fixed string. It checks the PROPERTY across a
 * matrix of recipient zones — including the extremes (+14 Kiritimati, -11
 * Midway) and the non-hour offsets (+12:45 Chatham, +5:45 Kathmandu) — that the
 * viewer's half is exactly the recipient's half read on the viewer's clock.
 *
 * The device half of the matrix comes from the sweep: this file runs once per
 * TZ, so ten device zones x ten recipient zones are covered by the suite.
 */
const RECIPIENT_ZONES = [
  'Pacific/Kiritimati', // +14, the far edge
  'Pacific/Chatham', //    +12:45, quarter-hour
  'Asia/Kathmandu', //     +5:45, quarter-hour
  'Asia/Kolkata', //       +5:30, half-hour
  'Asia/Tokyo',
  'Europe/Berlin',
  'UTC',
  'America/New_York',
  'America/Denver',
  'Pacific/Midway', //     -11, the other edge
];

const SCHEDULED = '20:00';
const DATE = '2026-08-31';

/** Minutes-of-day `zone` shows at instant `at`. */
function wallMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
  return (get('hour') % 24) * 60 + get('minute');
}

/** The real instant at which `zone` reads `SCHEDULED` on `DATE`. */
function instantFor(zone: string): number {
  const start = new Date(`${DATE}T00:00:00Z`).getTime();
  for (let day = -1; day <= 1; day += 1) {
    for (let m = 0; m < 1440; m += 5) {
      const cand = new Date(start + day * 86_400_000 + m * 60_000);
      if (wallMinutes(zone, cand) === 20 * 60) return cand.getTime();
    }
  }
  throw new Error(`no instant found for ${zone}`);
}

/** Minutes-of-day from a rendered half, in either hour cycle. */
function renderedMinutes(half: string): number {
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(half);
  if (!m) throw new Error(`unparseable half: ${half}`);
  const raw = parseInt(m[1], 10);
  const mins = parseInt(m[2], 10);
  if (!m[3]) return (raw % 24) * 60 + mins;
  const h = /PM/i.test(m[3]) ? (raw % 12) + 12 : raw % 12;
  return h * 60 + mins;
}

describe('an A/B time names two clocks showing the same instant', () => {
  // THE APP'S device zone, not the process's. `Intl.resolvedOptions()` reports
  // the machine (or TZ), while the app reads `getDeviceTimezone()`, which under
  // test resolves through the expo-localization mock and falls back to
  // America/New_York when TZ is unset. A first cut of this test compared
  // against the machine and reported eleven false mismatches: it read
  // "2:00 AM (New York)" as wrong when that IS midnight in Denver.
  const device = getDeviceTimezone();
  const reference = new Date(`${DATE}T12:00:00Z`);

  it('the viewer half is the recipient half read on the viewer clock', () => {
    const mismatches: string[] = [];
    let dualPairsChecked = 0;

    for (const zone of RECIPIENT_ZONES) {
      const rendered = formatEventTimeForDisplay(SCHEDULED, zone, undefined, reference, '12h');
      if (!rendered.includes('/')) continue; // same zone as the device: suppressed
      dualPairsChecked += 1;

      const [recipientHalf, viewerHalf] = rendered.split('/').map((s) => s.trim());

      // The recipient half is the stored time, unconverted.
      expect(renderedMinutes(recipientHalf)).toBe(20 * 60);

      // The viewer half is that same instant on the device's clock.
      const expected = wallMinutes(device, new Date(instantFor(zone)));
      if (renderedMinutes(viewerHalf) !== expected) {
        mismatches.push(`${zone} -> ${device}: got ${viewerHalf}, expected ${expected} min`);
      }
    }

    expect(mismatches).toEqual([]);

    // ANTI-VACUITY. Every pair could have been suppressed as same-zone, and
    // an empty `mismatches` would then prove nothing at all. Under any device
    // zone at most one of the ten recipients can match it.
    expect(dualPairsChecked).toBeGreaterThanOrEqual(RECIPIENT_ZONES.length - 1);
  });

  it('names both zones whenever it shows two of them', () => {
    // A dual line with unlabelled halves is unreadable — the reader cannot tell
    // which clock is whose.
    for (const zone of RECIPIENT_ZONES) {
      const rendered = formatEventTimeForDisplay(SCHEDULED, zone, undefined, reference, '12h');
      if (!rendered.includes('/')) continue;
      const [a, b] = rendered.split('/');
      expect(a).toContain('(');
      expect(b).toContain('(');
    }
  });

  it('shows ONE bare time when the recipient shares the device zone', () => {
    const rendered = formatEventTimeForDisplay(SCHEDULED, device, undefined, reference, '12h');
    expect(rendered).not.toContain('/');
    expect(rendered).not.toContain('(');
  });
});
