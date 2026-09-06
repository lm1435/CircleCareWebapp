import { describe, it, expect, afterEach, vi } from 'vitest';
import { clockInZone } from '../recipientEventDate';

/**
 * The `% 24` in `clockInZone`, tested against an ICU that actually does it.
 *
 * Under `hour12: false` SOME ICU builds render midnight as hour `24` rather
 * than `00`. The Node build this suite happens to run on does not, so the
 * Postgres fixture can never exercise the guard — reverting it leaves the whole
 * 2,025-case suite green. That is precisely the kind of "covered" that isn't.
 *
 * So the condition is forced here instead: `Intl.DateTimeFormat` is stubbed to
 * emit `24`, which is the only way to prove on this machine that the guard
 * does anything.
 *
 * Why it matters: a dose stored as `"24:00"` is never past due, never
 * confirmable, and hydrates a day late — it silently drops out of every
 * adherence surface rather than failing loudly.
 */
afterEach(() => {
  vi.restoreAllMocks();
});

function stubIcuHour(hour: string, minute: string): void {
  // Must be a real `function` (not an arrow): vitest refuses to spy a
  // constructor with a non-constructible implementation, and `clockInZone`
  // calls `new Intl.DateTimeFormat(...)`.
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (this: unknown) {
    return {
      formatToParts: () => [
        { type: 'hour', value: hour },
        { type: 'literal', value: ':' },
        { type: 'minute', value: minute },
      ],
      format: () => '',
    } as unknown as Intl.DateTimeFormat;
  } as unknown as typeof Intl.DateTimeFormat);
}

describe('clockInZone midnight guard', () => {
  it('normalises an ICU that renders midnight as hour 24', () => {
    stubIcuHour('24', '00');
    expect(clockInZone(new Date('2026-09-01T00:00:00Z'), 'UTC')).toBe('00:00');
  });

  it('normalises 24 with a non-zero minute too', () => {
    // Belt and braces: the guard must not be special-cased to ":00".
    stubIcuHour('24', '30');
    expect(clockInZone(new Date('2026-09-01T00:30:00Z'), 'UTC')).toBe('00:30');
  });

  it('leaves every ordinary hour alone', () => {
    stubIcuHour('23', '59');
    expect(clockInZone(new Date('2026-09-01T23:59:00Z'), 'UTC')).toBe('23:59');
  });

  it('pads a single-digit hour to the wire format', () => {
    stubIcuHour('7', '05');
    expect(clockInZone(new Date('2026-09-01T07:05:00Z'), 'UTC')).toBe('07:05');
  });
});
