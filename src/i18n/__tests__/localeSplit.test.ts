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
 * or removing the dynamic `import('./es/index')` backend, fails this test.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { namespaces } from '../index';

const HERE = dirname(fileURLToPath(import.meta.url));
const I18N_DIR = join(HERE, '..');

const indexSource = readFileSync(join(I18N_DIR, 'index.ts'), 'utf8');

describe('src/i18n/index.ts locale splitting', () => {
  it('does not statically import any es/*.json namespace file', () => {
    expect(indexSource).not.toMatch(/from\s+['"]\.\/es\//);
  });

  it('still statically imports every en/*.json namespace file (eager fast path)', () => {
    for (const ns of namespaces) {
      const pattern = new RegExp(`from\\s+['"]\\./en/${ns}\\.json['"]`);
      expect(indexSource).toMatch(pattern);
    }
  });

  it('loads es on demand via a dynamic import of the combined ./es/index chunk', () => {
    expect(indexSource).toMatch(/import\(\s*['"]\.\/es\/index['"]\s*\)/);
  });

  it('registers an i18next backend so both first-load and changeLanguage() trigger the lazy fetch', () => {
    expect(indexSource).toMatch(/\.use\(\s*esBackend\s*\)/);
    expect(indexSource).toMatch(/partialBundledLanguages:\s*true/);
  });

  it('gates es in `resources` behind an import.meta.env.MODE === "test" check', () => {
    // The only way `es` may reach the `resources` object passed to `.init()`
    // is a variable populated INSIDE `if (import.meta.env.MODE === 'test')`
    // — vitest's own escape hatch for the ~60 test files that read Spanish
    // synchronously (see the comment above this block in the source). A real
    // (non-test) Vite build resolves that condition to `false` at build time,
    // so this whole branch — including the `./es/index` import — is
    // dead-code-eliminated; `es` must never be unconditionally bundled.
    const gateMatch = indexSource.match(
      /if\s*\(\s*import\.meta\.env\.MODE\s*===\s*['"]test['"]\s*\)\s*\{([^}]*)\}/s
    );
    expect(gateMatch).not.toBeNull();
    const gateBody = gateMatch?.[1] ?? '';
    expect(gateBody).toMatch(/import\(\s*['"]\.\/es\/index['"]\s*\)/);

    const initCallSource = indexSource.slice(indexSource.indexOf('.init({'));
    expect(initCallSource).toMatch(/en:\s*enResources/);
    // Whatever the test-mode gate assigns is the ONLY way `es:` appears here.
    const esKeyMatches = [...initCallSource.matchAll(/\bes:\s*(\w+)/g)];
    expect(esKeyMatches).toHaveLength(1);
    expect(esKeyMatches[0]?.[1]).not.toBe('enResources');
  });
});

describe('src/i18n/es/index.ts (combined locale chunk)', () => {
  it('statically imports every es/*.json namespace exactly once, so Vite emits one chunk', () => {
    const esIndexSource = readFileSync(join(I18N_DIR, 'es', 'index.ts'), 'utf8');
    for (const ns of namespaces) {
      const pattern = new RegExp(`from\\s+['"]\\./${ns}\\.json['"]`);
      expect(esIndexSource).toMatch(pattern);
    }
    expect(esIndexSource).toMatch(/export default/);
  });
});
