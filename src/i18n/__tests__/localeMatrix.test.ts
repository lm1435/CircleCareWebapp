/**
 * The locale parity matrix follows the REGISTRY. Real data: every registry
 * locale is complete (base) / sparse-valid (variant). Fake data: injecting a
 * locale into a registry fixture makes the matrix fail naming every missing key,
 * which is the proof that the suite is driven by the registry and not by a
 * hand-kept ['en', 'es'].
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { LOCALE_REGISTRY, type LocaleEntry } from '../locales';
import { findMatrixProblems, loadRegistryResources, type LocaleResources } from './localeMatrix';

const I18N_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const EN_ONE_OTHER: LocaleEntry = { code: 'en', pluralCategories: ['one', 'other'] };

/** A tiny fake resource set: en has a plain key and a plural key. */
const baseResources = (): LocaleResources => ({
  en: { common: { hello: 'Hello', items_one: '{{count}} item', items_other: '{{count}} items' } },
  fr: { common: { hello: 'Bonjour', items_one: '{{count}} article', items_other: '{{count}} articles' } },
});

describe('real registry + real resources', () => {
  it('every registry locale is complete (base) or sparse-valid (variant)', () => {
    const resources = loadRegistryResources(I18N_DIR, LOCALE_REGISTRY);
    expect(findMatrixProblems(LOCALE_REGISTRY, resources)).toEqual([]);
  });

  it('actually compares something (en has keys, es is loaded)', () => {
    const resources = loadRegistryResources(I18N_DIR, LOCALE_REGISTRY);
    expect(Object.keys(resources.en ?? {}).length).toBeGreaterThanOrEqual(19);
    expect(Object.keys(resources.es ?? {}).length).toBeGreaterThanOrEqual(19);
  });

  it('detects a key dropped from the real es resources (falsification)', () => {
    const resources = loadRegistryResources(I18N_DIR, LOCALE_REGISTRY);
    const common = resources.es?.common as Record<string, unknown>;
    const firstKey = Object.keys(common)[0] as string;
    delete common[firstKey];
    const problems = findMatrixProblems(LOCALE_REGISTRY, resources);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]).toMatch(new RegExp(`^es: missing common:${firstKey}`));
  });
});

describe('fake registry injection', () => {
  const FR: LocaleEntry = { code: 'fr', pluralCategories: ['one', 'other'] };
  const FR_CA: LocaleEntry = { code: 'fr-CA', base: 'fr', pluralCategories: ['one', 'other'] };

  it('passes when the injected base locale is complete', () => {
    expect(findMatrixProblems([EN_ONE_OTHER, FR], baseResources())).toEqual([]);
  });

  it('fails listing every missing key when a locale is injected without strings', () => {
    const res = baseResources();
    res.fr = { common: {} };
    expect(findMatrixProblems([EN_ONE_OTHER, FR], res)).toEqual([
      'fr: missing common:hello',
      'fr: missing common:items_one',
      'fr: missing common:items_other',
    ]);
  });

  it('requires plural forms in the locale\'s OWN categories', () => {
    const res = baseResources();
    const FR_MANY: LocaleEntry = { code: 'fr', pluralCategories: ['one', 'many', 'other'] };
    expect(findMatrixProblems([EN_ONE_OTHER, FR_MANY], res)).toEqual(['fr: missing common:items_many']);
  });

  it('reports extra keys a base locale carries that en does not', () => {
    const res = baseResources();
    (res.fr?.common as Record<string, string>).orphan = 'x';
    expect(findMatrixProblems([EN_ONE_OTHER, FR], res)).toEqual([
      'fr: extra key not in en common:orphan',
    ]);
  });

  it('variant override: sparse subset of base keys is valid', () => {
    const res = baseResources();
    res['fr-CA'] = { common: { hello: 'Allo' } };
    expect(findMatrixProblems([EN_ONE_OTHER, FR, FR_CA], res)).toEqual([]);
  });

  it('variant override: an unknown key fails', () => {
    const res = baseResources();
    res['fr-CA'] = { common: { helo: 'Allo' } };
    expect(findMatrixProblems([EN_ONE_OTHER, FR, FR_CA], res)).toEqual([
      'fr-CA: unknown override key common:helo (not in base fr)',
    ]);
  });

  it('variant override: a plural form of an existing stem is valid', () => {
    const res = baseResources();
    res['fr-CA'] = { common: { items_one: '{{count}} chose' } };
    expect(findMatrixProblems([EN_ONE_OTHER, FR, FR_CA], res)).toEqual([]);
  });

  it('a variant whose base is not registered fails', () => {
    const res = baseResources();
    res['fr-CA'] = { common: {} };
    expect(findMatrixProblems([EN_ONE_OTHER, FR_CA], res)).toEqual([
      'fr-CA: base "fr" is not in the registry',
    ]);
  });
});
