/**
 * Browser-language detection and resolution over the REAL i18next instance (1.2.2 flip).
 *
 * Variant selection follows the LANGUAGE TAG: a fr-CA browser lands on fr-CA, fr-BE on
 * the base fr, pt-BR on pt (Brazilian base), pt-PT on pt-PT, de-AT on de. A variant
 * resolves variant -> base -> en, so its sparse chunk AND its base chunk are loaded.
 */
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { SUPPORTED_LOCALES, normalizeLocale } from '@/i18n/locales';

const utils = () => i18n.services.languageUtils;

describe('detection: browser tag -> registry code', () => {
  it.each([
    ['fr-CA', 'fr-CA'],
    ['fr-ca', 'fr-CA'],
    ['fr-BE', 'fr'],
    ['fr-FR', 'fr'],
    ['fr', 'fr'],
    ['pt-BR', 'pt'],
    ['pt-PT', 'pt-PT'],
    ['pt-AO', 'pt'],
    ['de-AT', 'de'],
    ['de-CH', 'de'],
    ['it-IT', 'it'],
    ['es-MX', 'es'],
    ['en-GB', 'en'],
  ])('%s -> %s', (tag, expected) => {
    // nonExplicitSupportedLngs keeps a non-registered region tag as i18n.language
    // ('fr-BE'); what RENDERS is the first registry code of its hierarchy, and that is
    // also what normalizeLocale sends to the API.
    const detected = utils().getBestMatchFromCodes([tag]) as string;
    const renders = utils()
      .toResolveHierarchy(detected)
      .find((c: string) => (SUPPORTED_LOCALES as readonly string[]).includes(c));
    expect(renders).toBe(expected);
    expect(normalizeLocale(detected)).toBe(expected);
  });

  it('an exact registered variant is detected as itself, never its base', () => {
    expect(utils().getBestMatchFromCodes(['fr-CA'])).toBe('fr-CA');
    expect(utils().getBestMatchFromCodes(['pt-PT'])).toBe('pt-PT');
  });

  it('an untranslated browser language falls back to en', () => {
    expect(utils().getBestMatchFromCodes(['ja-JP'])).toBe('en');
  });

  it('supportedLngs is the registry (plus i18next cimode)', () => {
    const supported = (i18n.options.supportedLngs as string[]).filter((c) => c !== 'cimode');
    expect(supported).toEqual([...SUPPORTED_LOCALES]);
  });
});

describe('resolution: a variant also loads its base', () => {
  it.each([
    ['fr-CA', ['fr-CA', 'fr', 'en']],
    ['pt-PT', ['pt-PT', 'pt', 'en']],
    ['fr', ['fr', 'en']],
    ['de', ['de', 'en']],
  ])('%s resolves %j', (code, chain) => {
    expect(utils().toResolveHierarchy(code)).toEqual(chain);
  });

  it('a key the fr-CA override omits is served by fr, not English', async () => {
    await i18n.loadLanguages(['fr-CA', 'fr']);
    const t = i18n.getFixedT('fr-CA', 'profile');
    // fr-CA's profile.json is sparse; language.names lives only in the base bundle.
    expect(i18n.getResource('fr-CA', 'profile', 'language.names.de')).toBeUndefined();
    expect(t('language.names.de')).toBe('Deutsch');
    expect(t('language.description')).toBe(
      i18n.getResource('fr', 'profile', 'language.description') as string
    );
    expect(t('language.description')).not.toBe(
      i18n.getResource('en', 'profile', 'language.description') as string
    );
  });
});
