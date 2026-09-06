/**
 * A stored `scheduled_time` of "24:00" is midnight, and it must never read as
 * noon.
 *
 * Mirrors `mobile/src/__tests__/utils/midnightIsNotNoon.test.ts`. Mobile is the
 * source of truth for this module, and the same defect existed here: guards for
 * hour 24 sat on three individual readers while `formatTimeOfDay` — the single
 * renderer every displayed time flows through — had none.
 *
 * Measured on this file before the fix:
 *   formatTimeOfDay(24, 0, '12h')   -> "12:00 PM"   <- NOON
 *   formatEventTimeCompact('24:00') -> "12:00 PM"   <- NOON
 *   formatEventTimeCompact('00:00') -> "12:00 AM"
 *
 * `recipientEventDate.ts` documents the older `|| '00'` fallback that let
 * `hour12: false` ICU builds serialise midnight as "24:00", so these rows are
 * already stored — this is a live defect, not a defensive test.
 */
import { describe, it, expect } from 'vitest';
import {
  formatEventTimeCompact,
  formatTimeOfDay,
  isEventPastDue,
} from '../timezone';

const TZ = 'America/Denver';

describe('hour 24 is midnight, never noon', () => {
  it('renders 24:00 exactly as 00:00 does', () => {
    expect(formatEventTimeCompact('24:00', TZ, '12h')).toBe(formatEventTimeCompact('00:00', TZ, '12h'));
  });

  it('never renders a midnight dose in the afternoon', () => {
    const rendered = formatEventTimeCompact('24:00', TZ, '12h');
    expect(rendered).toContain('12:00');
    expect(rendered).not.toMatch(/PM/);
  });

  it('normalises at the renderer, so every caller inherits it', () => {
    expect(formatTimeOfDay(24, 0, '12h')).toBe(formatTimeOfDay(0, 0, '12h'));
    expect(formatTimeOfDay(24, 15, '24h')).toBe('00:15');
  });

  it('leaves every ordinary hour alone', () => {
    expect(formatTimeOfDay(0, 0, '12h')).toBe('12:00 AM');
    expect(formatTimeOfDay(12, 0, '12h')).toBe('12:00 PM');
    expect(formatTimeOfDay(13, 5, '12h')).toBe('1:05 PM');
    expect(formatTimeOfDay(23, 59, '24h')).toBe('23:59');
  });

  // Exercised through `isEventPastDue`, the public consumer of the private
  // `parseScheduledMinutes`, rather than exporting a helper just to test it.
  it('lets a 24:00 dose go past due, instead of never', () => {
    const nineAmDenver = new Date('2026-08-30T15:00:00Z');

    // Raw, "24:00" parsed to 1440 — a minute-of-day no clock reaches — so
    // `current > scheduled` was false forever and the dose was never overdue.
    expect(isEventPastDue('2026-08-30', '24:00', TZ, nineAmDenver)).toBe(true);
    expect(isEventPastDue('2026-08-30', '00:00', TZ, nineAmDenver)).toBe(true);
    expect(isEventPastDue('2026-08-30', '20:00', TZ, nineAmDenver)).toBe(false);
  });
});
