import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  firstNameOf,
  formatGivenWhen,
  fullNameOf,
  minutesAgo,
  newClientRequestId,
  recentDoseByOther,
} from '../asNeeded';

// "Last given" is an INSTANT read in the CARE RECIPIENT's zone. The browser's
// own zone (pinned to Denver here) must never decide the clock or the day.

const LABELS = { today: 'Today', yesterday: 'Yesterday' };
const NOW = new Date('2026-06-12T16:00:00Z'); // 10:00 AM Denver · 12:00 PM New York · 04:00 AM (Jun 13) Auckland

beforeEach(() => {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    timeZone: 'America/Denver',
  } as Intl.ResolvedDateTimeFormatOptions);
});
afterEach(() => vi.restoreAllMocks());

describe('formatGivenWhen — recipient-zone rendering', () => {
  it("reads the instant on the RECIPIENT's clock, and names the zone when the viewer is elsewhere", () => {
    // 15:15Z = 11:15 AM New York; the viewer is in Denver (9:15 AM).
    const out = formatGivenWhen('2026-06-12T15:15:00Z', 'America/New_York', '12h', 'en', LABELS, NOW);
    expect(out).toBe('11:15 AM (New York)');
    expect(out).not.toContain('9:15');
  });

  it('names no zone when the viewer shares it', () => {
    expect(formatGivenWhen('2026-06-12T15:15:00Z', 'America/Denver', '12h', 'en', LABELS, NOW)).toBe(
      '9:15 AM'
    );
  });

  it('day label is the RECIPIENT\'s day: 23:30 NY the night before is "Yesterday", not today', () => {
    // 2026-06-12T03:30Z = 11:30 PM on Jun 11 in New York (but already Jun 12 in UTC).
    const out = formatGivenWhen('2026-06-12T03:30:00Z', 'America/New_York', '12h', 'en', LABELS, NOW);
    expect(out).toBe('Yesterday, 11:30 PM (New York)');
  });

  it('half-hour zone: Kolkata clock, and an older date renders "Jun 9, ..." in the viewer\'s language', () => {
    expect(
      formatGivenWhen('2026-06-09T21:10:00Z', 'Asia/Kolkata', '12h', 'en', LABELS, NOW)
    ).toBe('Jun 10, 2:40 AM (Kolkata)');
  });

  it('Spanish: RAE meridiem and Spanish day names; 24h cycle honoured', () => {
    expect(
      formatGivenWhen('2026-06-12T15:15:00Z', 'America/Denver', '12h', 'es', {
        today: 'Hoy',
        yesterday: 'Ayer',
      }, NOW)
    ).toBe('9:15 a. m.');
    expect(
      formatGivenWhen('2026-06-11T15:15:00Z', 'America/Denver', '24h', 'es', {
        today: 'Hoy',
        yesterday: 'Ayer',
      }, NOW)
    ).toBe('Ayer, 09:15');
  });

  it('a malformed instant renders nothing rather than "Invalid Date"', () => {
    expect(formatGivenWhen('nope', 'America/New_York', '12h', 'en', LABELS, NOW)).toBe('');
  });
});

describe('recentDoseByOther — the coordination check', () => {
  const last = (id: string, minutesBefore: number, by = 'jennie') => ({
    id,
    given_at: new Date(NOW.getTime() - minutesBefore * 60_000).toISOString(),
    given_by: { id: by, first_name: 'Jennie', last_name: null },
    note: null,
  });

  it('another member 1 minute ago -> prompt', () => {
    expect(recentDoseByOther(last('d', 1), 'me', NOW)?.id).toBe('d');
  });
  it('another member 31 minutes ago -> no prompt', () => {
    expect(recentDoseByOther(last('d', 31), 'me', NOW)).toBeNull();
  });
  it('YOUR OWN recent dose never prompts', () => {
    expect(recentDoseByOther(last('d', 1, 'me'), 'me', NOW)).toBeNull();
  });
  it('no last dose -> no prompt', () => {
    expect(recentDoseByOther(null, 'me', NOW)).toBeNull();
    expect(recentDoseByOther(undefined, 'me', NOW)).toBeNull();
  });
  it('clock skew (a dose a few seconds in the future) still counts as just logged', () => {
    expect(recentDoseByOther(last('d', -0.2), 'me', NOW)).not.toBeNull();
  });
});

describe('small helpers', () => {
  it('names: first name, then email local part; full name joins both', () => {
    expect(firstNameOf({ first_name: ' Jennie ', last_name: 'Ruiz' })).toBe('Jennie');
    expect(firstNameOf({ first_name: null, email: 'ana@example.com' })).toBe('ana');
    expect(firstNameOf(null)).toBeNull();
    expect(fullNameOf({ first_name: 'Jennie', last_name: 'Ruiz' })).toBe('Jennie Ruiz');
    expect(fullNameOf({ first_name: '', last_name: '', email: 'ana@example.com' })).toBe('ana');
  });

  it('minutesAgo floors and never goes negative', () => {
    expect(minutesAgo('2026-06-12T15:58:30Z', NOW)).toBe(1);
    expect(minutesAgo('2026-06-12T16:05:00Z', NOW)).toBe(0);
  });

  it('newClientRequestId is a v4 UUID and a fresh one each call', () => {
    const a = newClientRequestId();
    const b = newClientRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
