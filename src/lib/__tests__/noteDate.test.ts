import {
  NOTE_PAGE_DAYS,
  daysBetween,
  olderPageRange,
  olderPagesNeeded,
  shiftDateBack,
} from '../noteDate';

describe('noteDate helpers (naive YYYY-MM-DD, machine-TZ independent)', () => {
  it('daysBetween / shiftDateBack are exact across DST and year ends', () => {
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-08-09', '2026-08-08')).toBe(-1);
    expect(shiftDateBack('2024-03-01', 1)).toBe('2024-02-29');
  });

  it('older pages are contiguous 92-day ranges before the base window', () => {
    const today = '2026-08-08';
    const baseFrom = shiftDateBack(today, NOTE_PAGE_DAYS - 1);
    const p1 = olderPageRange(today, 1);
    const p2 = olderPageRange(today, 2);
    expect(daysBetween(p1.from, p1.to) + 1).toBe(NOTE_PAGE_DAYS);
    expect(daysBetween(p1.to, baseFrom)).toBe(1);
    expect(daysBetween(p2.to, p1.from)).toBe(1);
  });

  it('olderPagesNeeded: 0 inside the base page, then one per 92 days', () => {
    expect([0, 91, 92, 183, 184].map(olderPagesNeeded)).toEqual([0, 0, 1, 1, 2]);
  });
});
