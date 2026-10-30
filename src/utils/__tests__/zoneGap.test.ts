import { describe, expect, it } from 'vitest';
import { zoneGap } from '../zoneGap';

const JAN = new Date('2026-01-15T12:00:00Z');
const JUL = new Date('2026-07-15T12:00:00Z');

describe('zoneGap', () => {
  it('is null when the clocks read the same (including alias names)', () => {
    expect(zoneGap('America/Denver', 'America/Denver', JAN)).toBeNull();
    expect(zoneGap('Asia/Kolkata', 'Asia/Calcutta', JAN)).toBeNull();
  });

  it('Denver viewer, New York recipient: 2 hours ahead of you', () => {
    expect(zoneGap('America/Denver', 'America/New_York', JAN)).toEqual({
      direction: 'ahead',
      hours: 2,
    });
  });

  it('Denver viewer, Los Angeles recipient: 1 hour behind you', () => {
    expect(zoneGap('America/Denver', 'America/Los_Angeles', JAN)).toEqual({
      direction: 'behind',
      hours: 1,
    });
  });

  it('London recipient seen from Denver: 7 hours ahead in winter, 7 in summer', () => {
    expect(zoneGap('America/Denver', 'Europe/London', JAN)?.hours).toBe(7);
    expect(zoneGap('America/Denver', 'Europe/London', JUL)?.hours).toBe(7);
  });

  it('Phoenix and Denver read the same in winter and differ by an hour in summer', () => {
    expect(zoneGap('America/Phoenix', 'America/Denver', JAN)).toBeNull();
    expect(zoneGap('America/Phoenix', 'America/Denver', JUL)).toEqual({
      direction: 'ahead',
      hours: 1,
    });
  });

  it('keeps half hours (India vs UTC) instead of rounding', () => {
    expect(zoneGap('UTC', 'Asia/Kolkata', JAN)).toEqual({ direction: 'ahead', hours: 5.5 });
  });
});
