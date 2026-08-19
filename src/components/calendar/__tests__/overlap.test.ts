import { describe, expect, it } from 'vitest';
import { overlapKey, resolveOverlaps } from '../overlap';

const event = (
  id: string,
  scheduled_time: string | null,
  duration_minutes?: number,
  scheduled_date = '2026-08-16'
) => ({ id, scheduled_time, duration_minutes, scheduled_date });

describe('resolveOverlaps', () => {
  it('gives a lone event the full column', () => {
    const lanes = resolveOverlaps([event('a', '08:00:00')]);
    expect(lanes.get(overlapKey(event('a', '08:00:00')))).toEqual({
      column: 0,
      totalColumns: 1,
    });
  });

  it('splits the column across events that share a start time', () => {
    // The regression this module exists for: five 8:00 AM medications used to
    // render at identical coordinates, so four were invisible.
    const meds = ['aspirin', 'metformin', 'atorvastatin', 'vitaminD3', 'lisinopril'].map((id) =>
      event(id, '08:00:00')
    );
    const lanes = resolveOverlaps(meds);

    expect(lanes.size).toBe(5);
    const infos = meds.map((med) => lanes.get(overlapKey(med)));
    expect(infos.every((info) => info?.totalColumns === 5)).toBe(true);
    expect(infos.map((info) => info?.column).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('starts a new group once an event begins after the previous group ends', () => {
    const morning = event('morning', '08:00:00', 30);
    const evening = event('evening', '20:00:00', 30);
    const lanes = resolveOverlaps([morning, evening]);

    expect(lanes.get(overlapKey(morning))).toEqual({ column: 0, totalColumns: 1 });
    expect(lanes.get(overlapKey(evening))).toEqual({ column: 0, totalColumns: 1 });
  });

  it('groups a partial overlap — starts before the running event ends', () => {
    const first = event('first', '09:00:00', 60);
    const second = event('second', '09:30:00', 30);
    const lanes = resolveOverlaps([first, second]);

    expect(lanes.get(overlapKey(first))?.totalColumns).toBe(2);
    expect(lanes.get(overlapKey(second))?.totalColumns).toBe(2);
  });

  it('does not group an event that starts exactly when the previous one ends', () => {
    const first = event('first', '09:00:00', 30);
    const second = event('second', '09:30:00', 30);
    const lanes = resolveOverlaps([first, second]);

    expect(lanes.get(overlapKey(first))?.totalColumns).toBe(1);
    expect(lanes.get(overlapKey(second))?.totalColumns).toBe(1);
  });

  it('falls back to a 30-minute duration when duration_minutes is unset', () => {
    // 08:00 + default 30 = 08:30, so 08:15 collides but 08:45 does not.
    const base = event('base', '08:00:00');
    const inside = event('inside', '08:15:00');
    const outside = event('outside', '08:45:00');
    const lanes = resolveOverlaps([base, inside, outside]);

    expect(lanes.get(overlapKey(base))?.totalColumns).toBe(2);
    expect(lanes.get(overlapKey(inside))?.totalColumns).toBe(2);
    expect(lanes.get(overlapKey(outside))?.totalColumns).toBe(1);
  });

  it('ignores all-day events', () => {
    const lanes = resolveOverlaps([event('allday', null), event('timed', '08:00:00')]);

    expect(lanes.size).toBe(1);
    expect(lanes.get(overlapKey(event('timed', '08:00:00')))?.totalColumns).toBe(1);
  });

  it('keys two same-day doses of one recurring parent separately', () => {
    // A virtual instance id is `${parentId}_${date}`, so both doses of a
    // twice-daily medication carry the SAME id — keying by id alone would drop
    // one of them from the map.
    const morning = event('med-1_2026-08-16', '08:00:00');
    const evening = event('med-1_2026-08-16', '20:00:00');
    const lanes = resolveOverlaps([morning, evening]);

    expect(lanes.size).toBe(2);
    expect(overlapKey(morning)).not.toBe(overlapKey(evening));
  });

  it('does not mutate the array it is given', () => {
    const events = [event('late', '20:00:00'), event('early', '08:00:00')];
    resolveOverlaps(events);
    expect(events.map((e) => e.id)).toEqual(['late', 'early']);
  });
});
