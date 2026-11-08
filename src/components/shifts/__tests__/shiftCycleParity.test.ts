import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCyclePreview } from '../shiftRotation';

// PARITY: the "Days on / off" preview must show exactly the days the backend schedules. The fixture is
// produced by the backend's REAL matcher (backend/scripts/gen-cycle-fixtures.ts: dateMatchesRecurrence /
// generateVirtualInstances); mobile and web carry byte-identical copies. Dates are naive `YYYY-MM-DD`
// (recipient frame), so the result must not depend on the device timezone.

const FIXTURE = join(__dirname, '__fixtures__', 'shiftCycleParity.json');
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  windowDays: number;
  cases: Array<{ name: string; start: string; on: number; off: number; end: string; onDays: string[] }>;
};

describe('cycle preview parity with the backend matcher', () => {
  it('covers the cases the owner asked for', () => {
    expect(fixture.windowDays).toBe(42);
    expect(fixture.cases.length).toBeGreaterThanOrEqual(30);
    const keys = new Set(fixture.cases.map((c) => `${c.on}/${c.off}`));
    for (const k of ['9/8', '1/1', '3/4', '7/7', '14/7', '7/14', '30/30', '999/1', '1/999']) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it.each(fixture.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const { cells, leading } = buildCyclePreview(c.start, c.on, c.off);
    expect(cells).toHaveLength(fixture.windowDays);
    expect(cells[0].date).toBe(c.start);
    expect(cells[cells.length - 1].date).toBe(c.end);
    expect(cells.filter((x) => x.on).map((x) => x.date)).toEqual(c.onDays);
    // Sunday-first columns: leading blanks = the start's weekday; Monday-first shifts by one.
    const weekday = new Date(`${c.start}T12:00:00Z`).getUTCDay();
    expect(leading).toBe(weekday);
    expect(buildCyclePreview(c.start, c.on, c.off, 1).leading).toBe((weekday + 6) % 7);
  });

  it('the three copies of the fixture are byte-identical (when the sibling repos are checked out)', () => {
    const mine = readFileSync(FIXTURE);
    const root = join(__dirname, '..', '..', '..', '..', '..');
    const siblings = [
      join(root, 'backend', 'scripts', 'fixtures', 'shift-cycle-parity.json'),
      join(root, 'mobile', 'src', '__tests__', 'fixtures', 'shiftCycleParity.json'),
    ];
    for (const p of siblings) {
      if (existsSync(p)) expect(readFileSync(p).equals(mine)).toBe(true);
    }
  });
});
