import { legalUrl } from '../legalLinks';

describe('legalUrl', () => {
  it.each([
    ['en', 'https://circlecare.app/terms'],
    ['en-US', 'https://circlecare.app/terms'],
    [undefined, 'https://circlecare.app/terms'],
    ['', 'https://circlecare.app/terms'],
    // Registered app languages WITHOUT a marketing mirror link the English page (never a 404).
    ['fr', 'https://circlecare.app/terms'],
    ['fr-CA', 'https://circlecare.app/terms'],
    ['fr-BE', 'https://circlecare.app/terms'],
    ['de', 'https://circlecare.app/terms'],
    ['it', 'https://circlecare.app/terms'],
    ['pt', 'https://circlecare.app/terms'],
    ['pt-PT', 'https://circlecare.app/terms'],
    ['est', 'https://circlecare.app/terms'], // "es" prefix is not Spanish
    ['es', 'https://circlecare.app/es/terms'],
    ['es-MX', 'https://circlecare.app/es/terms'],
    ['es-419', 'https://circlecare.app/es/terms'],
    ['ES', 'https://circlecare.app/es/terms'],
  ])('terms for %j -> %s', (language, expected) => {
    expect(legalUrl('terms', language)).toBe(expected);
  });

  it('privacy mirrors the same rule', () => {
    expect(legalUrl('privacy', 'es')).toBe('https://circlecare.app/es/privacy');
    expect(legalUrl('privacy', 'en')).toBe('https://circlecare.app/privacy');
    expect(legalUrl('privacy', 'de')).toBe('https://circlecare.app/privacy');
  });

  it('every mirror locale is a registry code (a typo would silently send users to English)', async () => {
    const { LEGAL_MIRROR_LOCALES } = await import('../legalLinks');
    const { SUPPORTED_LOCALES } = await import('@/i18n/locales');
    for (const code of LEGAL_MIRROR_LOCALES) expect(SUPPORTED_LOCALES).toContain(code);
  });
});
