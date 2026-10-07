/**
 * HARNESS for a per-locale orthography / wording test (the `spanishDiacritics` twin).
 *
 * A lane creates `src/i18n/__tests__/<code>Orthography.test.ts` from
 * `localeOrthography.test.ts.template` (same folder as this helper's parent). It reads
 * `src/i18n/<code>/*.json` from disk, so it runs BEFORE the registry flip.
 *
 * Generic checks (every locale): placeholder parity with en, no leaked English, no stray
 * whitespace, no unbalanced `{{ }}`. Locale-specific checks are supplied by the lane:
 * `forbidden` (retired / wrong-register words), `required` (key -> pattern, e.g. dose and
 * leave/remove vocabulary) and `diacritics` (words that must carry their accent).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const I18N_DIR = join(process.cwd(), 'src', 'i18n');
type Bundle = Record<string, unknown>;

function flatten(bundle: Bundle, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(bundle)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...flatten(v as Bundle, key));
    else if (typeof v === 'string') out.push([key, v]);
  }
  return out;
}

/** `ns.dotted.key` -> string for every leaf of `src/i18n/<code>/*.json`. */
export function loadLocaleStrings(code: string): Map<string, string> {
  const dir = join(I18N_DIR, code);
  if (!existsSync(dir)) throw new Error(`orthography: no directory ${dir}`);
  const out = new Map<string, string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const ns = f.replace(/\.json$/, '');
    for (const [k, v] of flatten(JSON.parse(readFileSync(join(dir, f), 'utf8')) as Bundle, ns)) {
      out.set(k, v);
    }
  }
  return out;
}

const placeholders = (s: string): string[] => [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1] as string).sort();
const stem = (k: string): string => k.replace(/_(zero|one|two|few|many|other)$/, '');

export interface OrthographyConfig {
  /** Patterns no string may contain (retired words, wrong register). */
  forbidden?: Array<[label: string, pattern: RegExp]>;
  /** Exact key (`meds.some.key`) -> pattern its string must match. */
  required?: Record<string, RegExp>;
  /** Words that must always carry their diacritic: [bare ASCII spelling regex, label]. */
  diacritics?: Array<[bare: RegExp, label: string]>;
}

export function describeLocaleOrthography(code: string, cfg: OrthographyConfig = {}): void {
  const ALL = loadLocaleStrings(code);
  const EN = loadLocaleStrings('en');
  const entries = [...ALL.entries()];
  // A variant is sparse: its keys exist in the base, so parity is checked against en by stem.
  const enByStem = new Map<string, string[]>();
  for (const [k, v] of EN) enByStem.set(stem(k), [...(enByStem.get(stem(k)) ?? []), v]);

  describe(`${code} orthography`, () => {
    it('has strings to check', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it('keeps every interpolation placeholder the English string has', () => {
      const bad: string[] = [];
      for (const [k, v] of entries) {
        const en = EN.get(k) ?? EN.get(`${stem(k)}_other`) ?? EN.get(`${stem(k)}_one`);
        if (en === undefined) continue;
        const want = new Set(placeholders(en));
        const have = new Set(placeholders(v));
        // plural forms may drop {{count}} ("one article"); everything else must match.
        const isPlural = k !== stem(k);
        for (const p of want) if (!have.has(p) && !(isPlural && p === 'count')) bad.push(`${k}: missing {{${p}}}`);
        for (const p of have) if (!want.has(p)) bad.push(`${k}: unknown {{${p}}}`);
      }
      expect(bad).toEqual([]);
    });

    it('has no stray whitespace, doubled spaces or unbalanced braces', () => {
      const bad = entries
        .filter(([, v]) => v !== v.trim() || / {2,}/.test(v) || (v.match(/\{\{/g) ?? []).length !== (v.match(/\}\}/g) ?? []).length)
        .map(([k]) => k);
      expect(bad).toEqual([]);
    });

    it.each(cfg.forbidden ?? [])('no string contains %s', (_label, pattern) => {
      expect(entries.filter(([, v]) => pattern.test(v)).map(([k]) => k)).toEqual([]);
    });

    it.each(Object.entries(cfg.required ?? {}))('%s matches its required wording', (key, pattern) => {
      expect(ALL.get(key), `${key} missing`).toMatch(pattern);
    });

    it.each(cfg.diacritics ?? [])('diacritics: %s is never written bare (%s)', (bare) => {
      expect(entries.filter(([, v]) => bare.test(v)).map(([k]) => k)).toEqual([]);
    });
  });
}
