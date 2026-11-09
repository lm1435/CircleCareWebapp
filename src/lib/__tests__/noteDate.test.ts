import {
  NOTE_PAGE_DAYS,
  daysBetween,
  olderPageRange,
  olderPagesNeeded,
  shiftDateBack,
  loadedNotesFloor,
  olderNotesExist,
  olderSeekPages,
  OLDER_SEEK_BATCH,
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

describe('oldest_note_date helpers (additive backend field, 2026-11-09)', () => {
  it('loadedNotesFloor: the base from, or the deepest older page\'s from', () => {
    expect(loadedNotesFloor('2026-08-08', '2026-07-26', 0)).toBe('2026-07-26');
    expect(loadedNotesFloor('2026-08-08', '2026-05-09', 1)).toBe(olderPageRange('2026-08-08', 1).from);
    expect(loadedNotesFloor('2026-08-08', '2026-05-09', 3)).toBe(olderPageRange('2026-08-08', 3).from);
  });
  it('olderNotesExist: undefined when the field is absent, false for null, strict < floor otherwise', () => {
    expect(olderNotesExist(undefined, '2026-07-26')).toBeUndefined();
    expect(olderNotesExist(null, '2026-07-26')).toBe(false);
    expect(olderNotesExist('2026-07-26', '2026-07-26')).toBe(false);
    expect(olderNotesExist('2026-07-25', '2026-07-26')).toBe(true);
  });
  it('olderSeekPages: enough to cover the oldest, batched, at least one', () => {
    // 400 days back from 2026-08-08 needs 4 older pages
    expect(olderSeekPages('2026-08-08', 0, '2025-07-04')).toBe(4);
    // two years back needs 8: two batches of 4
    expect(olderSeekPages('2026-08-08', 0, '2024-06-01')).toBe(OLDER_SEEK_BATCH);
    expect(olderSeekPages('2026-08-08', 4, '2024-06-01')).toBe(4);
    expect(olderSeekPages('2026-08-08', 0, '2026-03-11')).toBe(1);
    expect(olderSeekPages('2026-08-08', 5, '2026-03-11')).toBe(1);
  });
});
