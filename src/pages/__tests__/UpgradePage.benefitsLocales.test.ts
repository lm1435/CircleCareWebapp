import { describe, it, expect } from 'vitest';
import { LOCALE_REGISTRY } from '@/i18n/locales';

// Every locale (variants resolved through their base, as the runtime does)
// must give the Premium benefits list all six entries with a title and a sub,
// and must state the free baseline. Order lives in UpgradePage.tsx and is
// pinned by UpgradePage.test.tsx; here the FULL tables also keep the six keys
// in that order so a translator reading the file sees what leads.

type Benefit = { title?: string; sub?: string };
type UpgradeTable = { benefits?: Record<string, Benefit>; freeBaseline?: string };

const tables = import.meta.glob<UpgradeTable>('../../i18n/*/upgrade.json', {
  eager: true,
  import: 'default',
});

function table(code: string): UpgradeTable {
  const t = tables[`../../i18n/${code}/upgrade.json`];
  if (!t) throw new Error(`no upgrade.json for ${code}`);
  return t;
}

const ORDER = ['caregivers', 'voice', 'exports', 'storage', 'ai', 'circles'];

describe('upgrade benefits: every locale', () => {
  it.each(LOCALE_REGISTRY.map((l) => [l.code, 'base' in l ? l.base : null] as const))(
    '%s resolves all six benefits and the free baseline',
    (code, base) => {
      const own = table(code);
      const fallback = base ? table(base) : {};
      for (const id of ORDER) {
        const title = own.benefits?.[id]?.title ?? fallback.benefits?.[id]?.title;
        const sub = own.benefits?.[id]?.sub ?? fallback.benefits?.[id]?.sub;
        expect(title, `${code} benefits.${id}.title`).toBeTruthy();
        expect(sub, `${code} benefits.${id}.sub`).toBeTruthy();
      }
      expect(own.freeBaseline ?? fallback.freeBaseline, `${code} freeBaseline`).toBeTruthy();
    }
  );

  it.each(LOCALE_REGISTRY.filter((l) => !('base' in l)).map((l) => l.code))(
    '%s keeps the benefits in the paywall order (family members first, circles last)',
    (code) => {
      expect(Object.keys(table(code).benefits ?? {})).toEqual(ORDER);
    }
  );

  it.each(LOCALE_REGISTRY.map((l) => l.code))(
    '%s free baseline never says "two caregivers" (it is you + 1)',
    (code) => {
      const fb = table(code).freeBaseline;
      if (fb) expect(fb).toMatch(/\+ 1/);
    }
  );
});
