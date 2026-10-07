/**
 * Registry-driven locale-parity checker (A9). Pure: takes a registry and the
 * loaded resources, returns human-readable problems. `localeMatrix.test.ts`
 * runs it on the real registry and on injected fake registries.
 *
 * Rules:
 *   - BASE locale (no `base`): complete against English. Every English leaf must
 *     exist, with plural keys required in THAT locale's own categories.
 *     Keys English lacks are reported as extras.
 *   - VARIANT locale (`base` set): a SPARSE override layer. It may omit any key,
 *     but every key it carries must exist in its base (unknown keys fail), so a
 *     typo in an override can never silently fail to render.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LocaleEntry } from '../locales';

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type LocaleResources = Record<string, Record<string, Json>>;

const PLURAL = /_(zero|one|two|few|many|other)$/;

/** `ns:dotted.path` for every leaf. */
export function flattenLeaves(res: Record<string, Json>): Set<string> {
  const out = new Set<string>();
  const walk = (node: Json, ns: string, prefix: string): void => {
    if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
      for (const [k, v] of Object.entries(node)) walk(v, ns, prefix ? `${prefix}.${k}` : k);
    } else {
      out.add(`${ns}:${prefix}`);
    }
  };
  for (const [ns, tree] of Object.entries(res)) walk(tree, ns, '');
  return out;
}

const stem = (key: string): string => key.replace(PLURAL, '');
const isPlural = (key: string): boolean => PLURAL.test(key);

/** Keys the given locale must carry to be complete against `enKeys`. */
function requiredFor(enKeys: Set<string>, entry: LocaleEntry): Set<string> {
  const out = new Set<string>();
  for (const key of enKeys) {
    if (isPlural(key)) {
      for (const cat of entry.pluralCategories) out.add(`${stem(key)}_${cat}`);
    } else {
      out.add(key);
    }
  }
  return out;
}

export function findMatrixProblems(
  registry: readonly LocaleEntry[],
  resources: LocaleResources
): string[] {
  const problems: string[] = [];
  const keysOf = (code: string): Set<string> => flattenLeaves(resources[code] ?? {});
  const enKeys = keysOf('en');

  for (const entry of registry) {
    if (entry.code === 'en') continue;
    const have = keysOf(entry.code);

    if (!entry.base) {
      for (const key of requiredFor(enKeys, entry)) {
        if (!have.has(key)) problems.push(`${entry.code}: missing ${key}`);
      }
      const allowed = requiredFor(enKeys, entry);
      const allowedStems = new Set([...allowed].map(stem));
      for (const key of have) {
        // An extra plural FORM of a known stem (es `count_many`, CLDR's 1e6 form,
        // which the product never formats) is harmless; an unknown stem is not.
        if (isPlural(key) && allowedStems.has(stem(key))) continue;
        if (!allowed.has(key)) problems.push(`${entry.code}: extra key not in en ${key}`);
      }
    } else {
      const baseEntry = registry.find((r) => r.code === entry.base);
      if (!baseEntry) {
        problems.push(`${entry.code}: base "${entry.base}" is not in the registry`);
        continue;
      }
      // Override keys must exist in the base (plural stems count).
      const baseKeys = keysOf(baseEntry.code);
      const baseStems = new Set([...baseKeys].map(stem));
      for (const key of have) {
        if (!baseKeys.has(key) && !(isPlural(key) && baseStems.has(stem(key)))) {
          problems.push(`${entry.code}: unknown override key ${key} (not in base ${entry.base})`);
        }
      }
    }
  }
  return problems;
}

/** Load `<i18nDir>/<code>/*.json` for each registry code (missing dir = empty). */
export function loadRegistryResources(
  i18nDir: string,
  registry: readonly LocaleEntry[]
): LocaleResources {
  const out: LocaleResources = {};
  for (const { code } of registry) {
    const dir = join(i18nDir, code);
    out[code] = {};
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      out[code][file.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    }
  }
  return out;
}
