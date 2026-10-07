/**
 * Per-locale FILE guard: a lane that creates `src/i18n/<code>/` (JSON namespaces + index.ts)
 * is validated BEFORE the registry flip. Discovers every locale directory on disk (not just
 * registered ones), builds a synthetic registry from them (variant = `xx-YY` whose base dir
 * `xx` exists; plural categories PROBED, never hand-kept) and runs the same matrix checker as
 * `localeMatrix.test.ts`. Also asserts every registered locale has its directory.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALE_REGISTRY, type LocaleEntry } from '../locales';
import { findMatrixProblems, loadRegistryResources } from './localeMatrix';

const I18N_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = /^[a-z]{2,3}(-[A-Z]{2})?$/;

function probe(code: string): string[] {
  const rules = new Intl.PluralRules(code);
  const seen = new Set<string>(['other']);
  for (let n = 0; n <= 10000; n++) seen.add(rules.select(n));
  return [...seen].sort();
}

const dirs = readdirSync(I18N_DIR).filter(
  (d) => TAG.test(d) && statSync(join(I18N_DIR, d)).isDirectory()
);

const onDisk: LocaleEntry[] = dirs.map((code) => {
  const base = code.split('-')[0] as string;
  const isVariant = code !== base && dirs.includes(base);
  return { code, ...(isVariant ? { base } : {}), pluralCategories: probe(code) };
});

describe('locale directories on disk', () => {
  it('every registered locale has a directory with an index.ts (en is bundled eagerly)', () => {
    for (const { code } of LOCALE_REGISTRY) {
      expect(existsSync(join(I18N_DIR, code)), `${code} dir`).toBe(true);
      if (code !== 'en') expect(existsSync(join(I18N_DIR, code, 'index.ts')), `${code}/index.ts`).toBe(true);
    }
  });

  it('every locale directory present (registered or not) is complete (base) / sparse-valid (variant)', () => {
    const resources = loadRegistryResources(I18N_DIR, onDisk);
    expect(findMatrixProblems(onDisk, resources)).toEqual([]);
  });
});
