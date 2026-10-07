import { legalUrl } from '../legalLinks';

describe('legalUrl', () => {
  it.each([
    ['en', 'https://circlecare.app/terms'],
    ['en-US', 'https://circlecare.app/terms'],
    [undefined, 'https://circlecare.app/terms'],
    ['', 'https://circlecare.app/terms'],
    ['fr-CA', 'https://circlecare.app/terms'], // unshipped -> English (never a 404 mirror)
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
  });
});
