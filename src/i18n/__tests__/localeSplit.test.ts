/**
 * Locale-splitting guard (Task W6b).
 *
 * `src/i18n/index.ts` used to statically import all 19 es/*.json namespace
 * files (~22 KB gzip) alongside the en ones, so every English-only session —
 * the majority — paid for Spanish strings it would never render. Spanish is
 * now loaded on demand through a custom i18next `BackendModule` that
 * dynamically `import()`s `./es/index` (the combined es chunk).
 *
 * This reads the SOURCE with `node:fs` rather than importing the module:
 * importing `@/i18n` actually runs `i18n.init()` against jsdom (which
 * defaults to `navigator.language = 'en-US'`), so it would never exercise —
 * or even reveal the existence of — the es-loading branch either way.
 * Scanning the source text is also what proves the STATIC import is gone,
 * which is the actual bundle-size claim: Vite can only chunk-split what
 * isn't eagerly imported at the top of the module graph.
 *
 * Mutation check: re-adding a static `import esX from './es/x.json'` line,
 * or removing a locale's `localeLoaders` entry, fails this test. Generalized
 * over the registry (A10): every non-EN registry locale must be a lazy chunk.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { namespaces } from '../index';
import { LOCALE_REGISTRY, NON_EN_LOCALES } from '../locales';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(HERE, '..');

const indexSource = readFileSync(join(I18N_DIR, 'index.ts'), 'utf8');

/** The `localeLoaders` map literal, as written in the source. */
function loaderMapBody(): string {
  const m = indexSource.match(/const localeLoaders: LocaleLoaders = \{([\s\S]*?)\n\};/);
  expect(m).not.toBeNull();
  return m?.[1] ?? '';
}

describe('src/i18n/index.ts locale splitting', () => {
  it('has a non-EN locale to guard (registry sanity)', () => {
    expect(NON_EN_LOCALES.length).toBeGreaterThan(0);
    expect(LOCALE_REGISTRY.map((l) => l.code)).toContain('en');
  });

  it.each(NON_EN_LOCALES)('does not statically import any %s/*.json namespace file', (code) => {
    expect(indexSource).not.toMatch(new RegExp(`from\\s+['"]\\./${code}/`));
    expect(indexSource).not.toMatch(new RegExp(`^\\s*import\\s+['"]\\./${code}/`, 'm'));
  });

  it('statically imports no directory that is not "en" (any registry code, variants included)', () => {
    const staticLocaleImports = [...indexSource.matchAll(/^import\s[^;]*?from\s+['"]\.\/([^/'"]+)\//gm)]
      .map((m) => m[1]);
    expect([...new Set(staticLocaleImports)]).toEqual(['en']);
  });

  it('still statically imports every en/*.json namespace file (eager fast path)', () => {
    for (const ns of namespaces) {
      const pattern = new RegExp(`from\\s+['"]\\./en/${ns}\\.json['"]`);
      expect(indexSource).toMatch(pattern);
    }
  });

  it.each(NON_EN_LOCALES)('has a lazy loader entry for registry locale %s', (code) => {
    // `es: () => import('./es/index')` — a dynamic import of that locale's combined chunk.
    expect(loaderMapBody()).toMatch(
      new RegExp(`\\b${code}:\\s*\\(\\)\\s*=>\\s*import\\(\\s*['"]\\./${code}/index['"]\\s*\\)`)
    );
  });

  it('has no loader entry for a locale the registry does not list', () => {
    const keys = [...loaderMapBody().matchAll(/^\s*([\w'-]+):\s*\(\)/gm)].map((m) =>
      (m[1] ?? '').replace(/'/g, '')
    );
    expect(keys.sort()).toEqual([...NON_EN_LOCALES].sort());
  });

  it('registers an i18next backend so both first-load and changeLanguage() trigger the lazy fetch', () => {
    expect(indexSource).toMatch(/\.use\(\s*localeBackend\s*\)/);
    expect(indexSource).toMatch(/partialBundledLanguages:\s*true/);
  });

  it('gates non-EN locales in `resources` behind an import.meta.env.MODE === "test" check', () => {
    // The only way a non-EN locale may reach the `resources` object passed to
    // `.init()` is `testOnlyLocaleResources`, populated INSIDE
    // `if (import.meta.env.MODE === 'test')` — vitest's own escape hatch for the
    // ~60 test files that read Spanish synchronously. A real (non-test) Vite
    // build resolves that condition to `false`, so the loop (and thus any eager
    // reach into a locale chunk) is dead-code-eliminated.
    const gateMatch = indexSource.match(
      /if\s*\(\s*import\.meta\.env\.MODE\s*===\s*['"]test['"]\s*\)\s*\{([\s\S]*?)\n\}/
    );
    expect(gateMatch).not.toBeNull();
    expect(gateMatch?.[1] ?? '').toMatch(/testOnlyLocaleResources\[code\]\s*=/);

    const initCallSource = indexSource.slice(indexSource.indexOf('.init({'));
    expect(initCallSource).toMatch(/en:\s*enResources/);
    expect(initCallSource).toMatch(/\.\.\.testOnlyLocaleResources/);
    // No locale code is hand-listed as a resource key (that would be an eager import).
    for (const code of NON_EN_LOCALES) {
      expect(initCallSource).not.toMatch(new RegExp(`\\b${code}:\\s*\\w+Resources`));
    }
  });
});

describe.each(NON_EN_LOCALES)('src/i18n/%s/index.ts (combined locale chunk)', (code) => {
  it('statically imports every namespace JSON exactly once, so Vite emits one chunk', () => {
    const chunkSource = readFileSync(join(I18N_DIR, code, 'index.ts'), 'utf8');
    for (const ns of namespaces) {
      const pattern = new RegExp(`from\\s+['"]\\./${ns}\\.json['"]`);
      expect(chunkSource).toMatch(pattern);
    }
    expect(chunkSource).toMatch(/export default/);
  });
});
