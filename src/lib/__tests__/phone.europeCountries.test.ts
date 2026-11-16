import { getCountryCallingCode } from 'libphonenumber-js/min';
import {
  PHONE_COUNTRIES,
  findPhoneCountryByCallingCode,
  initialPhoneValue,
  internationalDialNumber,
  phoneCountryForLocale,
  resolveSeed,
} from '@/lib/phone';
import { telHref } from '@/components/emergency/PhoneLink';
import en from '@/i18n/en/emergency.json';
import es from '@/i18n/es/emergency.json';
import de from '@/i18n/de/emergency.json';
import fr from '@/i18n/fr/emergency.json';
import itBundle from '@/i18n/it/emergency.json';
import pt from '@/i18n/pt/emergency.json';

// 1.4.2 — a German caregiver could not pick +49. Mobile twin (same cases):
// mobile/src/__tests__/components/PhoneInput.europeCountries.test.tsx.

describe('the country list', () => {
  it('every calling code matches libphonenumber-js metadata (getCountryCallingCode)', () => {
    for (const c of PHONE_COUNTRIES) {
      expect(c.callingCode).toBe(`+${getCountryCallingCode(c.iso2)}`);
    }
  });

  it('every country has a name in every base locale', () => {
    for (const bundle of [en, es, de, fr, itBundle, pt] as Array<{
      phone: { countries: Record<string, string> };
    }>) {
      for (const c of PHONE_COUNTRIES) {
        expect(bundle.phone.countries[c.iso2]).toEqual(expect.any(String));
      }
    }
  });

  it('shared codes resolve to the FIRST country: +1 -> US (not CA), +39 -> IT (not VA)', () => {
    expect(findPhoneCountryByCallingCode('+1')?.iso2).toBe('US');
    expect(findPhoneCountryByCallingCode('+39')?.iso2).toBe('IT');
    expect(findPhoneCountryByCallingCode('+44')?.iso2).toBe('GB');
    expect(findPhoneCountryByCallingCode('+41')?.iso2).toBe('CH');
    expect(findPhoneCountryByCallingCode('+423')?.iso2).toBe('LI');
    expect(findPhoneCountryByCallingCode('+81')).toBeUndefined();
  });
});

describe('resolveSeed / initialPhoneValue for the 1.4.2 countries', () => {
  it('P: a stored "+49" seeds DE with the national digits', () => {
    expect(resolveSeed('030 12345678', '+49', 'US')).toEqual({ digits: '03012345678', iso2: 'DE' });
    expect(resolveSeed('+49 30 12345678', undefined, 'US')).toEqual({
      digits: '3012345678',
      iso2: 'DE',
    });
  });

  it('P: shared "+39" is refined by the number (Vatican City vs Italy)', () => {
    expect(resolveSeed('06 698 12345', '+39', 'US').iso2).toBe('VA');
    expect(resolveSeed('06 1234 5678', '+39', 'US').iso2).toBe('IT');
  });

  it('N: stored US / MX / ES numbers are saved exactly as before', () => {
    expect(initialPhoneValue('(303) 555-1234', '+1')).toEqual({
      phone: '(303) 555-1234',
      countryCode: '+1',
    });
    expect(initialPhoneValue('55 1234 5678', '+52')).toEqual({
      phone: '55 1234 5678',
      countryCode: '+52',
    });
    expect(initialPhoneValue('612 34 56 78', '+34')).toEqual({
      phone: '612 34 56 78',
      countryCode: '+34',
    });
  });

  it('N: an unsupported "+81" record is kept verbatim and does not throw', () => {
    expect(resolveSeed('03 1234 5678', '+81', 'US')).toEqual({ digits: '0312345678', iso2: undefined });
    expect(initialPhoneValue('03 1234 5678', '+81')).toEqual({
      phone: '03 1234 5678',
      countryCode: '+81',
    });
  });
});

describe('phoneCountryForLocale', () => {
  it.each([
    ['de-DE', 'DE'],
    ['de', 'DE'],
    ['fr', 'FR'],
    ['it', 'IT'],
    ['pt', 'BR'],
    ['en-GB', 'GB'],
    ['en-AU', 'AU'],
    ['pt-PT', 'PT'],
    ['de_AT', 'AT'],
    ['fr-CA', 'CA'],
    ['es-MX', 'MX'],
    ['de-JP', 'DE'], // unoffered region: the language decides
    ['es', 'US'],
    ['es-419', 'US'],
    ['en', 'US'],
    ['ja-JP', 'US'],
    ['', 'US'],
  ])('%s -> %s', (tag, expected) => {
    expect(phoneCountryForLocale(tag)).toBe(expected);
  });

  it('an explicit region wins over the tag', () => {
    expect(phoneCountryForLocale('de', 'CH')).toBe('CH');
    expect(phoneCountryForLocale(null, null)).toBe('US');
  });
});

describe('internationalDialNumber / telHref', () => {
  it.each([
    ['030 12345678', '+49', '+493012345678'], // trunk 0 dropped
    ['020 7946 0958', '+44', '+442079460958'],
    ['06 1234 5678', '+39', '+390612345678'], // Italy keeps its 0
    ['(555) 201-3344', '+1', '+15552013344'],
    ['55 1234 5678', '+52', '+525512345678'],
  ])('%s + %s -> %s', (phone, cc, expected) => {
    expect(internationalDialNumber(phone, cc)).toBe(expected);
    expect(telHref(phone, cc)).toBe(`tel:${expected}`);
  });

  it.each([
    ['+49 30 12345678', '+49', 'tel:+493012345678'], // already international
    ['03 1234 5678', '+81', 'tel:+810312345678'], // not offered: old join
    ['555-0101', '+1', 'tel:+15550101'], // not possible: old join
    ['030 12345678', null, 'tel:03012345678'],
  ])('%s + %s keeps the old href %s', (phone, cc, expected) => {
    expect(internationalDialNumber(phone, cc)).toBeNull();
    expect(telHref(phone, cc)).toBe(expected);
  });
});
