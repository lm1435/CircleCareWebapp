import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner 2026-11-10: tapping Care on a phone opened the hour grid (Week) and the page jumped.
// Below lg the calendar opens on Day (as the mobile app's Care calendar does); desktop keeps Week;
// a note deep link keeps Week. Source contract (the page's full render needs the whole data stack).
describe('CalendarPage default view', () => {
  const src = readFileSync(join(__dirname, '../CalendarPage.tsx'), 'utf8');

  it('opens on Day below lg, Week at lg+ or for a note deep link', () => {
    expect(src).toMatch(
      /useState<CalendarView>\(\(\) =>\s*pendingNoteLink \|\| typeof window\.matchMedia !== 'function' \|\| window\.matchMedia\('\(min-width: 64rem\)'\)\.matches\s*\?\s*'week'\s*:\s*'day'/
    );
  });

  it('no longer hard-codes Week as the only default', () => {
    expect(src).not.toMatch(/useState<CalendarView>\('week'\)/);
  });
});
