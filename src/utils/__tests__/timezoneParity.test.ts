import { describe, it, expect } from 'vitest';
import { formatTimeOfDay, zoneReferenceInstant, timezonesAreDifferent, getTimezoneOffsetMinutes } from '../timezone';
import fixture from '../../test/fixtures/timezoneParity.json';
/**
 * ONE SET OF TIMEZONE EXPECTATIONS, RUN BY BOTH REPOS.
 *
 * `mobile/src/utils/timezone.ts` says "Mobile is the SOURCE OF TRUTH" and the
 * webapp mirrors it — but nothing enforced that, and on 2026-08-31 the two were
 * found sharing TWO defects:
 *
 *   1. `zoneReferenceInstant` parsed without a `Z`, anchoring DST decisions to
 *      noon in the DEVICE zone (skew up to 14h);
 *   2. `formatTimeOfDay` had no hour-24 guard, so a midnight dose rendered as
 *      "12:00 PM" — twelve hours wrong, in both apps.
 *
 * Each was found and fixed separately, days apart, after shipping in both. A
 * shared expectation file is what turns "fixed here" into "cannot regress
 * there": add a case when either repo fixes a timezone bug, copy the file
 * across, and the other repo inherits the regression test.
 *
 * The fixture is deliberately DATA, not code — the two repos have different
 * module systems, test runners and export surfaces (8 exports exist only on
 * web, 5 only on mobile), so sharing behaviour is possible where sharing code
 * is not.
 */
type Case = {
  id: string;
  why?: string;
  fn: string;
  args: unknown[];
  atISO?: string;
  expect?: unknown;
  expectISO?: string;
};

function runCase(c: Case): unknown {
  const at = c.atISO ? new Date(c.atISO) : undefined;
  switch (c.fn) {
    case 'formatTimeOfDay':
      return formatTimeOfDay(c.args[0] as number, c.args[1] as number, c.args[2] as never);
    case 'zoneReferenceInstant':
      return zoneReferenceInstant(c.args[0] as string).toISOString();
    case 'timezonesAreDifferent':
      return timezonesAreDifferent(c.args[0] as string, c.args[1] as string, at as Date);
    case 'getTimezoneOffsetMinutes':
      return getTimezoneOffsetMinutes(c.args[0] as string, at as Date);
    default:
      throw new Error(`unknown fn in parity fixture: ${c.fn}`);
  }
}

describe('timezone behaviour matches the shared cross-repo fixture', () => {
  const cases = fixture.cases as Case[];

  it('the fixture is present and non-trivial', () => {
    // Anti-vacuity: an empty or unreadable fixture would make every case below
    // pass by never running.
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(cases.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const actual = runCase(c);
    const expected = c.expectISO !== undefined ? c.expectISO : c.expect;
    expect(actual).toEqual(expected);
  });
});

/**
 * Mirror of the mobile guard: the two copies must stay byte-identical, or
 * "shared" is a story we tell ourselves. Skipped when the sibling repo is not
 * checked out, so a webapp-only clone still runs green.
 */
describe('the fixture is genuinely shared, not merely duplicated', () => {
  it('matches the mobile copy byte for byte', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const mine = path.resolve(process.cwd(), 'src/test/fixtures/timezoneParity.json');
    const sibling = path.resolve(process.cwd(), '../mobile/src/__tests__/fixtures/timezoneParity.json');

    if (!fs.existsSync(sibling)) {
      expect(fs.existsSync(mine)).toBe(true);
      return;
    }
    expect(fs.readFileSync(sibling, 'utf8')).toBe(fs.readFileSync(mine, 'utf8'));
  });
});
