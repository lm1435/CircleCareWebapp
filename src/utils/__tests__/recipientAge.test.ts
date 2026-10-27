import { computeRecipientAge } from '../recipientAge';

/**
 * Age is counted against the CARE RECIPIENT's today, not UTC's.
 *
 * The old Hero `computeAge` read UTC getters, so on the recipient's birthday an
 * APAC recipient was a year short until UTC caught up, and an Americas
 * recipient aged the evening before. The zone is an explicit argument, so these
 * cases do not depend on the process zone.
 */
describe('computeRecipientAge', () => {
  const DOB = '1946-10-28';

  it('Sydney 09:00 on the birthday (still 10-27 in UTC): already 80', () => {
    // 2026-10-28 09:00 AEDT = 2026-10-27T22:00Z
    expect(computeRecipientAge(DOB, 'Australia/Sydney', new Date('2026-10-27T22:00:00Z'))).toBe(80);
  });

  it('Denver 20:00 the evening before (already 10-28 in UTC): still 79', () => {
    // 2026-10-27 20:00 MDT = 2026-10-28T02:00Z
    expect(computeRecipientAge(DOB, 'America/Denver', new Date('2026-10-28T02:00:00Z'))).toBe(79);
  });

  it('same instant, different recipient zones, different ages', () => {
    const now = new Date('2026-10-27T22:00:00Z');
    expect(computeRecipientAge(DOB, 'Australia/Sydney', now)).toBe(80);
    expect(computeRecipientAge(DOB, 'America/Denver', now)).toBe(79);
  });

  it('counts the birthday on the day itself and not before', () => {
    const now = new Date('2026-09-05T18:00:00Z');
    expect(computeRecipientAge('1946-09-05', 'America/New_York', now)).toBe(80);
    expect(computeRecipientAge('1946-09-06', 'America/New_York', now)).toBe(79);
  });

  it('accepts a timestamp-shaped value by its date part', () => {
    expect(
      computeRecipientAge('1946-09-05T00:00:00Z', 'America/New_York', new Date('2026-09-05T18:00:00Z'))
    ).toBe(80);
  });

  it('returns null for an unparseable, impossible or absurd value', () => {
    const now = new Date('2026-09-05T18:00:00Z');
    expect(computeRecipientAge('nonsense', 'UTC', now)).toBeNull();
    expect(computeRecipientAge('1946-02-30', 'UTC', now)).toBeNull();
    expect(computeRecipientAge('1800-01-01', 'UTC', now)).toBeNull();
    expect(computeRecipientAge('2027-01-01', 'UTC', now)).toBeNull();
  });
});
