import { describe, it, expect } from 'vitest';
import { LOCALE_REGISTRY } from '@/i18n/locales';

// Every locale (variants resolved through their base, as the runtime does)
// must give the paywall all eight rows (three reasons + five behind "See
// everything included") with a title and a sub, and must state the free plan.
// Display order lives in UpgradePage.tsx (REASONS, DETAILS) and is pinned by
// UpgradePage.compact.test.tsx.

type Benefit = { title?: string; sub?: string };
type UpgradeTable = { benefits?: Record<string, Benefit>; onboarding?: { continueFreeSub?: string } };

const tables = import.meta.glob<UpgradeTable>('../../i18n/*/upgrade.json', {
  eager: true,
  import: 'default',
});

function table(code: string): UpgradeTable {
  const t = tables[`../../i18n/${code}/upgrade.json`];
  if (!t) throw new Error(`no upgrade.json for ${code}`);
  return t;
}

const ROWS = ['caregivers', 'shifts', 'circles', 'voice', 'team', 'exports', 'storage', 'ai'];

describe('upgrade benefits: every locale', () => {
  it.each(LOCALE_REGISTRY.map((l) => [l.code, 'base' in l ? l.base : null] as const))(
    '%s resolves all eight rows and the free-plan line',
    (code, base) => {
      const own = table(code);
      const fallback = base ? table(base) : {};
      for (const id of ROWS) {
        const title = own.benefits?.[id]?.title ?? fallback.benefits?.[id]?.title;
        const sub = own.benefits?.[id]?.sub ?? fallback.benefits?.[id]?.sub;
        expect(title, `${code} benefits.${id}.title`).toBeTruthy();
        expect(sub, `${code} benefits.${id}.sub`).toBeTruthy();
      }
      const free = own.onboarding?.continueFreeSub ?? fallback.onboarding?.continueFreeSub;
      expect(free, `${code} onboarding.continueFreeSub`).toBeTruthy();
    }
  );

  it.each(LOCALE_REGISTRY.filter((l) => !('base' in l)).map((l) => l.code))(
    '%s has exactly the eight rows the page renders, no stale ones',
    (code) => {
      expect(Object.keys(table(code).benefits ?? {}).sort()).toEqual([...ROWS].sort());
    }
  );

  it.each(LOCALE_REGISTRY.map((l) => l.code))(
    '%s free-plan line never says "two caregivers" (it is you + 1)',
    (code) => {
      const fb = table(code).onboarding?.continueFreeSub;
      if (fb) expect(fb).toMatch(/\+ 1/);
    }
  );
});
