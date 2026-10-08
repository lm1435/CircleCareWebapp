/**
 * PLURAL TRAP (pt lane). CLDR: bare `pt` selects `_one` for BOTH 0 and 1; `pt-PT` selects
 * `_other` for 0. Every count key must read correctly at count 0 in both variants. Renders
 * every plural key of every namespace through a REAL i18next (chain pt-PT -> pt -> en) at
 * 0 / 1 / 2 and asserts no count-0 string hard-codes "1" or reads "0 <singular noun>".
 * Reads src/i18n/<code>/*.json from disk, so it runs before the registry flip.
 */
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';

const DIR = join(process.cwd(), 'src', 'i18n');
const load = (code: string): Record<string, object> =>
  Object.fromEntries(
    readdirSync(join(DIR, code))
      .filter((f) => f.endsWith('.json'))
      .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(DIR, code, f), 'utf8'))])
  );

/** Keys whose `_one` hard-codes "1" because the UI returns early at 0 (proven at the call site). */
const RENDERED_ONLY_ABOVE_ZERO: Record<string, string> = {
  'members:pending.banner.count': 'PendingInvitesBanner returns null when count === 0',
};
/**
 * Whole namespaces whose count lines are NEVER rendered at 0: the daily update omits a line
 * whose count is 0 (plan §2.1) — `buildSummaryLines` filters `count > 0`, and `names.many`
 * is only reached with count >= 1 (`formatNoteAuthors`). Both proven in
 * src/lib/__tests__/dailyUpdateCopy.test.ts ("omits every zero count").
 */
const NAMESPACES_RENDERED_ONLY_ABOVE_ZERO = ['dailyUpdate:'];
const neverAtZero = (key: string): boolean =>
  NAMESPACES_RENDERED_ONLY_ABOVE_ZERO.some((ns) => key.startsWith(ns));
// upgrade:trialPeriod.* is a store trial length spliced as "teste grátis de {{period}}" (UpgradePage):
// the store never reports a 0-length trial, so its `_one` keeps the natural "{{count}} dia".
const INVARIANT_AFTER_NUMBER = new Set(['min', 'h', 'mg', 'ml', 'em', 'de', 'do', 'da', 'para', 'por', 'a', 'e', 'mais']);
const VARS = { name: 'Ana', names: 'Ana', zone: 'Lisboa', email: 'a@b.c', times: '08:00', day: 'seg.' };

const stems = (o: unknown, p = ''): string[] => {
  const out: string[] = [];
  if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      const key = p ? `${p}.${k}` : k;
      if (typeof v === 'string') {
        const m = /^(.*)_(one|other)$/.exec(key);
        if (m) out.push(m[1]);
      } else out.push(...stems(v, key));
    }
  }
  return [...new Set(out)];
};

describe('pt / pt-PT plural keys read correctly at count 0', () => {
  const i18n = i18next.createInstance();
  const pt = load('pt');
  const STEMS = Object.entries(pt).flatMap(([ns, bundle]) => stems(bundle).map((s) => `${ns}:${s}`));
  beforeAll(async () => {
    await i18n.init({
      resources: { en: load('en'), pt, 'pt-PT': load('pt-PT') },
      lng: 'pt',
      ns: Object.keys(pt),
      fallbackLng: { 'pt-PT': ['pt', 'en'], default: ['en'] },
      interpolation: { escapeValue: false },
    });
  });

  it('premise: CLDR selects _one for 0 in pt and _other in pt-PT', () => {
    expect(new Intl.PluralRules('pt').select(0)).toBe('one');
    expect(new Intl.PluralRules('pt-PT').select(0)).toBe('other');
    expect(STEMS.length).toBeGreaterThan(10);
  });

  it.each(['pt', 'pt-PT'])('%s: count 0 never hard-codes "1" and never reads "0 <singular>"', (lng) => {
    const t = i18n.getFixedT(lng);
    const bad: string[] = [];
    for (const key of STEMS) {
      const out = t(key, { count: 0, ...VARS });
      if (neverAtZero(key)) continue;
      if (/(^|[^\d{])1(\s|$)/.test(out) && !RENDERED_ONLY_ABOVE_ZERO[key]) bad.push(`${key}: "${out}" (hard-coded 1)`);
      const m = /(^|[^\d])0\s+([\p{L}]+)/u.exec(out);
      if (m && !INVARIANT_AFTER_NUMBER.has(m[2].toLowerCase()) && !/s$/i.test(m[2]) && !key.startsWith('upgrade:trialPeriod.')) {
        bad.push(`${key}: "${out}" (0 + singular "${m[2]}")`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('review artifact: every plural key at 0 / 1 / 2 in both variants', () => {
    const out: Record<string, string[]> = {};
    for (const lng of ['pt', 'pt-PT']) {
      const t = i18n.getFixedT(lng);
      for (const key of STEMS) out[`${lng} ${key}`] = [0, 1, 2].map((count) => t(key, { count, ...VARS }));
    }
    expect(out).toMatchSnapshot();
  });
});
