import { describe, expect, it } from 'vitest';
import {
  buildCyclePreview,
  cycleBucket,
  parseCycleCount,
  parseCycleRule,
  rotationPosition,
} from '../shiftRotation';

describe('parseCycleRule / parseCycleCount', () => {
  it('parses cycle:N:M and rejects everything else', () => {
    expect(parseCycleRule('cycle:14:7')).toEqual({ on: 14, off: 7 });
    expect(parseCycleRule('cycle:999:1')).toEqual({ on: 999, off: 1 });
    for (const bad of ['cycle', 'cycle:0:7', 'cycle:7:0', 'cycle:1000:1', 'cycle:a:b', 'weekly', null, undefined, '']) {
      expect(parseCycleRule(bad as string | null | undefined)).toBeNull();
    }
  });

  it('accepts whole numbers 1-999 only', () => {
    expect(parseCycleCount('7')).toBe(7);
    expect(parseCycleCount('999')).toBe(999);
    for (const bad of ['', '0', '1000', '1.5', '-3', '1e2', 'abc', ' ']) {
      expect(parseCycleCount(bad)).toBeNull();
    }
  });
});

describe('buildCyclePreview (6 weeks from the shift date)', () => {
  // Sun Nov 8 2026, 14 on / 7 off.
  const p = buildCyclePreview('2026-11-08', 14, 7);
  const byDate = (d: string) => p.cells.find((c) => c.date === d)!;

  it('has 42 day cells and no leading gap when it starts on the first weekday column', () => {
    expect(p.cells).toHaveLength(42);
    expect(p.leading).toBe(0);
    expect(p.cells[0].date).toBe('2026-11-08');
    expect(p.cells[41].date).toBe('2026-12-19');
  });

  it('Nov 8-21 on, Nov 22-28 off, Nov 29 on again', () => {
    expect(byDate('2026-11-08').on).toBe(true);
    expect(byDate('2026-11-21').on).toBe(true);
    expect(byDate('2026-11-22').on).toBe(false);
    expect(byDate('2026-11-28').on).toBe(false);
    expect(byDate('2026-11-29').on).toBe(true);
    expect(byDate('2026-12-12').on).toBe(true);
    expect(byDate('2026-12-13').on).toBe(false);
  });

  it('marks the 1st of a month with its month number', () => {
    expect(byDate('2026-12-01').firstOfMonth).toBe(12);
    expect(byDate('2026-11-30').firstOfMonth).toBeNull();
  });

  it('pads leading cells so a mid-week start lines up under the weekday header', () => {
    expect(buildCyclePreview('2026-11-11', 7, 7).leading).toBe(3); // Wed, Sunday-first
    expect(buildCyclePreview('2026-11-11', 7, 7, 1).leading).toBe(2); // Wed, Monday-first
    expect(buildCyclePreview('2026-11-08', 7, 7, 1).leading).toBe(6); // Sun, Monday-first
  });
});

describe('rotationPosition ("Day n of N")', () => {
  const anchor = '2026-11-08';
  it('day 1 and the last on-day of the block', () => {
    expect(rotationPosition('cycle:14:7', anchor, '2026-11-08')).toEqual({ day: 1, on: 14, backOn: '2026-11-29' });
    expect(rotationPosition('cycle:14:7', anchor, '2026-11-21')).toEqual({ day: 14, on: 14, backOn: '2026-11-29' });
  });

  it('second block restarts the count', () => {
    expect(rotationPosition('cycle:14:7', anchor, '2026-11-29')).toEqual({ day: 1, on: 14, backOn: '2026-12-20' });
  });

  it('off days have no position', () => {
    expect(rotationPosition('cycle:14:7', anchor, '2026-11-22')).toBeNull();
    expect(rotationPosition('cycle:14:7', anchor, '2026-11-28')).toBeNull();
  });

  it('is null before the anchor, for non-cycle rules and missing dates', () => {
    expect(rotationPosition('cycle:14:7', anchor, '2026-11-07')).toBeNull();
    expect(rotationPosition('weekly', anchor, '2026-11-08')).toBeNull();
    expect(rotationPosition(null, anchor, '2026-11-08')).toBeNull();
    expect(rotationPosition('cycle:14:7', '', '2026-11-08')).toBeNull();
  });
});

describe('cycleBucket', () => {
  it('buckets 1-3, 4-7, 8-14, 15+', () => {
    expect([1, 3, 4, 7, 8, 14, 15, 999].map(cycleBucket)).toEqual([
      '1-3', '1-3', '4-7', '4-7', '8-14', '8-14', '15+', '15+',
    ]);
  });
});
