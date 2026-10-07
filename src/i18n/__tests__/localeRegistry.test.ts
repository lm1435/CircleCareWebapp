/**
 * The webapp locale registry (`src/i18n/locales.ts`): shape, helpers, and
 * lockstep parity with the canonical backend list.
 *
 * Helpers are exercised against FAKE registries too (`createLocaleHelpers`), so
 * the fr-CA / fr-BE behaviour that no shipped locale triggers yet is proven now.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  LOCALE_LABELS,
  LOCALE_REGISTRY,
  NON_EN_LOCALES,
  SUPPORTED_LOCALES,
  baseLanguage,
  baseLocale,
  createLocaleHelpers,
  isSupportedLocale,
  localeChain,
  normalizeLocale,
  type LocaleEntry,
} from '../locales';
import { supportedLanguages } from '../index';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_LOCALES = join(HERE, '..', '..', '..', '..', 'backend', 'src', 'i18n', 'locales.ts');

/** CLDR categories reachable by the integer counts the product formats. */
function probePluralCategories(code: string): string[] {
  const rules = new Intl.PluralRules(code);
  const seen = new Set<string>(['other']);
  for (let n = 0; n <= 10000; n++) seen.add(rules.select(n));
  return [...seen].sort();
}

describe('LOCALE_REGISTRY shape', () => {
  it('ships the 1.2.2 set in picker order', () => {
    expect(LOCALE_REGISTRY.map((l) => l.code)).toEqual(['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT']);
    expect([...SUPPORTED_LOCALES]).toEqual(['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT']);
    expect(NON_EN_LOCALES).toEqual(['es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT']);
  });

  it('variants declare their base; native picker labels', () => {
    expect(LOCALE_REGISTRY.map((l) => (l as LocaleEntry).base ?? null)).toEqual([
      null, null, null, 'fr', null, null, null, 'pt',
    ]);
    expect(Object.values(LOCALE_LABELS)).toEqual([
      'English', 'Español', 'Français', 'Français (Canada)', 'Deutsch', 'Italiano',
      'Português (Brasil)', 'Português (Portugal)',
    ]);
  });

  it.each(LOCALE_REGISTRY.map((l) => [l.code, l.pluralCategories] as const))(
    '%s declares the plural categories integer counts actually reach',
    (code, declared) => {
      expect([...declared].sort()).toEqual(probePluralCategories(code));
    }
  );

  it('has a display label for every code and no extras (language picker)', () => {
    expect(Object.keys(LOCALE_LABELS).sort()).toEqual([...SUPPORTED_LOCALES].sort());
    expect(supportedLanguages).toBe(LOCALE_LABELS);
  });
});

describe('normalizeLocale / baseLanguage / localeChain (shipped registry)', () => {
  it.each([
    ['en', 'en'],
    ['en-US', 'en'],
    ['EN', 'en'],
    ['es', 'es'],
    ['es-MX', 'es'],
    ['es-419', 'es'],
    ['es_419', 'es'],
    ['  ES-mx ', 'es'],
    ['xx-YY', 'en'],
    ['est', 'en'], // starts with "es" but is Estonian: whole-subtag match, not a prefix
    ['esperanto', 'en'],
    ['', 'en'],
    [null, 'en'],
    [undefined, 'en'],
  ])('%j -> %s', (tag, expected) => {
    expect(normalizeLocale(tag as string | null | undefined)).toBe(expected);
    expect(baseLanguage(tag as string | null | undefined)).toBe(expected);
  });

  // Variant selection follows the LANGUAGE TAG only: exact variant, else the base.
  it.each([
    ['fr-CA', 'fr-CA', 'fr'],
    ['fr-ca', 'fr-CA', 'fr'],
    ['fr-BE', 'fr', 'fr'],
    ['fr-FR', 'fr', 'fr'],
    ['pt', 'pt', 'pt'],
    ['pt-BR', 'pt', 'pt'],
    ['pt-PT', 'pt-PT', 'pt'],
    ['pt-AO', 'pt', 'pt'],
    ['de-AT', 'de', 'de'],
    ['de-CH', 'de', 'de'],
    ['it-IT', 'it', 'it'],
  ])('%j -> normalize %s, base %s', (tag, norm, base) => {
    expect(normalizeLocale(tag)).toBe(norm);
    expect(baseLanguage(tag)).toBe(base);
  });

  it('chains and support checks', () => {
    expect(localeChain('es-MX')).toEqual(['es', 'en']);
    expect(localeChain('xx')).toEqual(['en']);
    expect(localeChain('fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
    expect(localeChain('pt-PT')).toEqual(['pt-PT', 'pt', 'en']);
    expect(baseLocale('es')).toBe('es');
    expect(isSupportedLocale('fr-CA')).toBe(true);
    expect(isSupportedLocale('es')).toBe(true);
    expect(isSupportedLocale('es-MX')).toBe(false);
    expect(isSupportedLocale(42)).toBe(false);
  });
});

describe('helpers over a FAKE registry (variants the shipped set does not have yet)', () => {
  const FAKE: readonly LocaleEntry[] = [
    { code: 'en', pluralCategories: ['one', 'other'] },
    { code: 'es', pluralCategories: ['one', 'other'] },
    { code: 'fr', pluralCategories: ['one', 'other'] },
    { code: 'fr-CA', base: 'fr', pluralCategories: ['one', 'other'] },
  ];
  const h = createLocaleHelpers(FAKE);

  it('fr-CA matches exactly (any case / separator)', () => {
    expect(h.normalizeLocale('fr-CA')).toBe('fr-CA');
    expect(h.normalizeLocale('fr_ca')).toBe('fr-CA');
  });
  it('fr-BE falls to the base language fr; xx falls to en', () => {
    expect(h.normalizeLocale('fr-BE')).toBe('fr');
    expect(h.normalizeLocale('xx')).toBe('en');
    expect(h.normalizeLocale('xx-YY')).toBe('en');
  });
  it('baseLanguage collapses a variant to its base; chain walks variant -> base -> en', () => {
    expect(h.baseLanguage('fr-CA')).toBe('fr');
    expect(h.baseLanguage('fr-BE')).toBe('fr');
    expect(h.localeChain('fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
    expect(h.localeChain('fr')).toEqual(['fr', 'en']);
    expect(h.localeChain('xx')).toEqual(['en']);
  });
  it('nonEnglishLocales follows the registry', () => {
    expect(h.nonEnglishLocales()).toEqual(['es', 'fr', 'fr-CA']);
  });
  it('a base cycle cannot hang the chain', () => {
    const cyc = createLocaleHelpers([
      { code: 'en', pluralCategories: ['one', 'other'] },
      { code: 'a', base: 'b', pluralCategories: ['other'] },
      { code: 'b', base: 'a', pluralCategories: ['other'] },
    ]);
    expect(cyc.localeChain('a')).toEqual(['a', 'b', 'en']);
  });
});

describe('lockstep parity with backend/src/i18n/locales.ts (canonical)', () => {
  // Canonical list. When the backend file is present (monorepo checkout) it is
  // parsed and compared; the literal is the fallback for a webapp-only checkout
  // and must be updated together with the backend registry.
  const CANONICAL_FALLBACK = ['en', 'es', 'fr', 'fr-CA', 'de', 'it', 'pt', 'pt-PT'];

  function backendEntries(): { code: string; base?: string }[] | null {
    if (!existsSync(BACKEND_LOCALES)) return null;
    const src = readFileSync(BACKEND_LOCALES, 'utf8');
    const block = /export const LOCALE_REGISTRY = \[([\s\S]*?)\] as const/.exec(src);
    if (!block) throw new Error('cannot find LOCALE_REGISTRY in backend locales.ts');
    return [...(block[1] as string).matchAll(/\{([^}]*)\}/g)].map((m) => ({
      code: /code:\s*'([^']+)'/.exec(m[1] as string)?.[1] as string,
      base: /base:\s*'([^']+)'/.exec(m[1] as string)?.[1],
    }));
  }

  it('registry codes (and bases) equal the canonical list, in order', () => {
    const backend = backendEntries();
    const canonical = backend ? backend.map((e) => e.code) : CANONICAL_FALLBACK;
    expect(LOCALE_REGISTRY.map((l) => l.code)).toEqual(canonical);
    if (backend) {
      expect(LOCALE_REGISTRY.map((l) => (l as LocaleEntry).base)).toEqual(
        backend.map((e) => e.base)
      );
    }
  });

  it('the fallback literal itself still matches the backend (so it cannot rot)', () => {
    const backend = backendEntries();
    if (backend) expect(CANONICAL_FALLBACK).toEqual(backend.map((e) => e.code));
  });
});
