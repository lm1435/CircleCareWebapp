/**
 * 1.4.2: the ES first-run payoff title wrapped "8:00 a." / "m." across two lines. Every displayed
 * time goes through formatTimeOfDay, so the fix is there (joinClockAndPeriod): a marker with a
 * space of its own (RAE "a. m." / "p. m.") is bound with U+00A0 to itself and to the clock; a
 * one-word marker ("AM", "a.m.") and the 24-hour clock are untouched.
 * Mobile parity: mobile/src/__tests__/utils/meridiemNoBreak.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { formatHourOfDay, formatTimeOfDay, joinClockAndPeriod } from '../timezone';

const NBSP = ' ';
const NNBSP = ' ';
// Any space a browser may wrap at (everything \s matches except the two no-break spaces).
const BREAKING_SPACE = /[^\S  ]/;

describe('time display never wraps inside the Spanish meridiem (web)', () => {
  it('POSITIVE (es): "8:00 a. m." has no breaking space, inside the marker or before it', () => {
    const am = formatTimeOfDay(8, 0, '12h', 'es');
    const pm = formatTimeOfDay(20, 0, '12h', 'es');
    expect(am).toBe(`8:00${NBSP}a.${NBSP}m.`);
    expect(pm).toBe(`8:00${NBSP}p.${NBSP}m.`);
    expect(am).not.toMatch(BREAKING_SPACE);
    expect(pm).not.toMatch(BREAKING_SPACE);
    expect(am.replace(/ /g, ' ')).toBe('8:00 a. m.');
  });

  it('POSITIVE (es): the week hour axis keeps "12 p. m." together', () => {
    expect(formatHourOfDay(12, '12h', 'es')).toBe(`12${NBSP}p.${NBSP}m.`);
  });

  it('NEGATIVE: English "8:00 AM" is byte-identical (plain space, no NBSP)', () => {
    expect(formatTimeOfDay(8, 0, '12h', 'en')).toBe('8:00 AM');
    expect(formatTimeOfDay(20, 0, '12h', 'en')).toBe('8:00 PM');
    expect(formatHourOfDay(9, '12h', 'en')).toBe('9 AM');
    expect(formatTimeOfDay(8, 0, '12h', 'en')).not.toContain(NBSP);
  });

  it('NEGATIVE: one-word markers elsewhere (de "AM", fr-CA / pt-PT "a.m.") keep the plain space', () => {
    expect(formatTimeOfDay(8, 0, '12h', 'de')).toBe('8:00 AM');
    expect(formatTimeOfDay(20, 45, '12h', 'fr-CA')).toBe('8:45 p.m.');
    expect(formatTimeOfDay(9, 5, '12h', 'pt-PT')).toBe('9:05 a.m.');
  });

  it.each(['en', 'es', 'de', 'fr', 'it', 'pt', 'pt-PT', 'fr-CA'] as const)(
    'NEGATIVE (%s): the 24-hour clock is unchanged, no marker and no NBSP',
    (lang) => {
      for (let h = 0; h < 24; h++) {
        expect(formatTimeOfDay(h, 30, '24h', lang)).toMatch(/^\d{2}:30$/);
      }
    }
  );

  it('NEGATIVE: never a doubled no-break space, and an ICU U+202F is kept, not doubled', () => {
    for (let h = 0; h < 24; h++) {
      const out = formatTimeOfDay(h, 5, '12h', 'es');
      expect(out).not.toMatch(/[  ]{2}/);
      expect(out.match(/ /g)).toHaveLength(2);
    }
    expect(joinClockAndPeriod('8:00', `a.${NNBSP}m.`)).toBe(`8:00${NBSP}a.${NNBSP}m.`);
    expect(joinClockAndPeriod('8:00', `a.${NBSP}m.`)).toBe(`8:00${NBSP}a.${NBSP}m.`);
  });
});
