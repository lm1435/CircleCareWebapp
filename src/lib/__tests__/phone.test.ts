import { AsYouType } from 'libphonenumber-js/min';
import {
  DEFAULT_PHONE_COUNTRY_ISO2,
  PHONE_COUNTRIES,
  findPhoneCountryByCallingCode,
  findPhoneCountryByIso2,
  formatNational,
  initialPhoneValue,
  isPossibleForCountry,
  isUnofferedInternationalNumber,
  phoneNumberBlocksSave,
  resolveSeed,
} from '@/lib/phone';

// Web port of mobile's PhoneInput `resolveSeed` + `phoneCountries.ts`
// (mobile/src/components/common/). Same cases as
// mobile/src/__tests__/components/PhoneInput.test.tsx "seeding" block.

describe('PHONE_COUNTRIES — mirrors mobile exactly', () => {
  it('has the same 23 countries in the same order', () => {
    expect(PHONE_COUNTRIES.map((c) => c.iso2)).toEqual([
      'US', 'CA', 'MX', 'PR', 'DO', 'GT', 'HN', 'SV', 'NI', 'CR', 'PA', 'CO',
      'VE', 'EC', 'PE', 'BO', 'CL', 'AR', 'UY', 'PY', 'BR', 'ES', 'CU',
    ]);
  });

  it('stores calling codes as "+NN" (backend country_code max 5)', () => {
    for (const c of PHONE_COUNTRIES) {
      expect(c.callingCode).toMatch(/^\+\d{1,3}$/);
      expect(c.callingCode.length).toBeLessThanOrEqual(5);
    }
  });

  it('defaults to US and "+1" resolves to the FIRST match (US)', () => {
    expect(DEFAULT_PHONE_COUNTRY_ISO2).toBe('US');
    expect(findPhoneCountryByCallingCode('+1')?.iso2).toBe('US');
    expect(findPhoneCountryByIso2('mx')?.callingCode).toBe('+52');
    expect(findPhoneCountryByIso2('GB')).toBeUndefined();
  });
});

describe('resolveSeed', () => {
  it.each([
    ['4165551234', 'CA'],
    ['7875551234', 'PR'],
    ['8095551234', 'DO'],
    ['3035551234', 'US'],
  ])('shared "+1": %s resolves to %s by area code', (value, iso2) => {
    expect(resolveSeed(value, '+1', 'US')).toEqual({ digits: value, iso2 });
  });

  it('"+52 55 1234 5678" with no country_code → MX + national digits', () => {
    expect(resolveSeed('+52 55 1234 5678', undefined, 'US')).toEqual({
      digits: '5512345678',
      iso2: 'MX',
    });
    expect(resolveSeed(' +52 55 1234 5678 ', '', 'US').iso2).toBe('MX');
  });

  it('strips a calling code baked into the value when country_code is present', () => {
    expect(resolveSeed('+52 55 1234 5678', '+52', 'US')).toEqual({
      digits: '5512345678',
      iso2: 'MX',
    });
  });

  it('"(303) 555-1234" with no country_code is unchanged (no country, same digits)', () => {
    expect(resolveSeed('(303) 555-1234', undefined, 'US')).toEqual({
      digits: '3035551234',
      iso2: undefined,
    });
  });

  it('a 10-digit string valid only as international is never reinterpreted', () => {
    expect(resolveSeed('5140145210', undefined, 'US').iso2).toBeUndefined();
  });

  it('a UK "+44…" number (not offered) falls back unchanged', () => {
    expect(resolveSeed('+44 20 7946 0958', undefined, 'US')).toEqual({
      digits: '442079460958',
      iso2: undefined,
    });
  });

  it('unprefixed digits valid only as international ("525512345678") seed MX', () => {
    expect(resolveSeed('525512345678', undefined, 'US')).toEqual({
      digits: '5512345678',
      iso2: 'MX',
    });
  });

  it('unprefixed digits that parse to a country but are not valid there keep the old behavior', () => {
    expect(resolveSeed('52551234567', undefined, 'US').iso2).toBeUndefined();
  });

  it('empty value keeps the calling-code country only', () => {
    expect(resolveSeed('', '+52', 'US')).toEqual({ digits: '', iso2: 'MX' });
    expect(resolveSeed('', undefined, 'US')).toEqual({ digits: '', iso2: undefined });
  });
});

describe('initialPhoneValue — what a modal saves when the phone is untouched', () => {
  it('normalizes a resolvable record to national format + calling code', () => {
    expect(initialPhoneValue('+52 55 1234 5678', null)).toEqual({
      phone: '55 1234 5678',
      countryCode: '+52',
    });
    expect(initialPhoneValue('4165551234', '+1')).toEqual({
      phone: '(416) 555-1234',
      countryCode: '+1',
    });
  });

  it('assigns +1 to a no-country number that is a valid US number', () => {
    expect(initialPhoneValue('(303) 555-1234', undefined)).toEqual({
      phone: '(303) 555-1234',
      countryCode: '+1',
    });
  });

  it('keeps an unresolvable record VERBATIM (never rewrites a UK number as US)', () => {
    expect(initialPhoneValue('+44 20 7946 0958', null)).toEqual({
      phone: '+44 20 7946 0958',
      countryCode: null,
    });
    expect(initialPhoneValue('020 7946 0958', '+44')).toEqual({
      phone: '020 7946 0958',
      countryCode: '+44',
    });
  });

  it('keeps a value with non-phone text verbatim (never strips "ext")', () => {
    expect(initialPhoneValue('555-0101 ext 4', '+1')).toEqual({
      phone: '555-0101 ext 4',
      countryCode: '+1',
    });
  });

  it('empty phone saves no country', () => {
    expect(initialPhoneValue('', '+52')).toEqual({ phone: '', countryCode: null });
    expect(initialPhoneValue(null, null)).toEqual({ phone: '', countryCode: null });
  });
});

describe('formatNational', () => {
  it('uses AsYouType for the country', () => {
    expect(formatNational('5512345678', 'MX')).toBe(new AsYouType('MX').input('5512345678'));
    expect(formatNational('3035551234', 'US')).toBe('(303) 555-1234');
    expect(formatNational('', 'US')).toBe('');
  });
});

// The user-facing hint is a LENGTH check, not `isValid`: fictional 555 numbers
// fill demo/test data, and the /min metadata can lag a newly assigned area
// code — neither is a reason to tell a caregiver their number is wrong.
describe('isPossibleForCountry — the hint check', () => {
  it('accepts a fictional 555 US number (possible length, not an assigned area code)', () => {
    expect(isPossibleForCountry('5551112222', 'US')).toBe(true);
  });

  it('rejects too few or too many digits for the country', () => {
    expect(isPossibleForCountry('555111222', 'US')).toBe(false);
    expect(isPossibleForCountry('55511122223', 'US')).toBe(false);
    expect(isPossibleForCountry('123', 'US')).toBe(false);
    expect(isPossibleForCountry('551234567', 'MX')).toBe(false);
  });

  it('accepts a possible-length number of the selected country', () => {
    expect(isPossibleForCountry('5512345678', 'MX')).toBe(true);
    expect(isPossibleForCountry('12345678', 'CU')).toBe(true);
  });

  it('empty is not flagged', () => {
    expect(isPossibleForCountry('', 'US')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// THE SAVE GATE. An invalid phone number is no longer stored (owner decision,
// iOS build 31). This table is SHARED WITH MOBILE, row for row —
// mobile/src/__tests__/components/PhoneInput.saveGate.test.tsx carries the same
// rows and must give the same verdicts. Change one, change both.
// [what the user typed, country, may it be saved?]
// ────────────────────────────────────────────────────────────────────────────
const PHONE_SAVE_CASES: ReadonlyArray<readonly [string, string, 'US' | 'MX' | 'ES' | 'GT', boolean]> = [
  ['empty', '', 'US', true],
  ['valid US', '3035551234', 'US', true],
  ['valid US, typed formatted', '(303) 555-1234', 'US', true],
  ['fictional 555 US (possible length)', '5551112222', 'US', true],
  ['US with the leading 1', '15551234567', 'US', true],
  ['too long (the number from the bug report)', '5121548191566', 'US', false],
  ['too long by one digit', '30355512345', 'US', false],
  ['too short (7-digit local number)', '5551234', 'US', false],
  ['valid non-US (Mexico)', '5512345678', 'MX', true],
  ['valid non-US (Spain)', '612345678', 'ES', true],
  ['valid non-US (Guatemala, 8 digits)', '22345678', 'GT', true],
  ['too short for Mexico', '55123456', 'MX', false],
  ['a US-length number under Spain', '3035551234', 'ES', false],
  ['extension-like junk', '555-123-4567 ext 4', 'US', false],
  ['extension-like junk, x-style', '(303) 555-1234 x12', 'US', false],
];

describe('the phone save gate — shared table (mobile gives the same verdicts)', () => {
  it.each(PHONE_SAVE_CASES)('%s: "%s" in %s → savable %s', (_label, typed, iso2, savable) => {
    const digits = typed.replace(/\D/g, '');
    expect(isPossibleForCountry(digits, iso2)).toBe(savable);
    expect(
      phoneNumberBlocksSave({ digits, iso2, changed: true, required: false, seededUnoffered: false })
    ).toBe(!savable);
  });
});

describe('phoneNumberBlocksSave — the stored-number exceptions', () => {
  const bad = { digits: '5551234', iso2: 'US' as const };

  it('a stored bad number on an OPTIONAL field blocks, changed or not', () => {
    expect(phoneNumberBlocksSave({ ...bad, changed: false, required: false, seededUnoffered: false })).toBe(true);
    expect(phoneNumberBlocksSave({ ...bad, changed: true, required: false, seededUnoffered: false })).toBe(true);
  });

  it('a stored bad number on a REQUIRED field does not block while untouched (it cannot be cleared)', () => {
    expect(phoneNumberBlocksSave({ ...bad, changed: false, required: true, seededUnoffered: false })).toBe(false);
    expect(phoneNumberBlocksSave({ ...bad, changed: true, required: true, seededUnoffered: false })).toBe(true);
  });

  it('a stored number of an un-offered country does not block while untouched', () => {
    const uk = { digits: '442079460958', iso2: 'US' as const };
    expect(phoneNumberBlocksSave({ ...uk, changed: false, required: false, seededUnoffered: true })).toBe(false);
    expect(phoneNumberBlocksSave({ ...uk, changed: true, required: false, seededUnoffered: true })).toBe(true);
  });
});

// Same rows as mobile's PhoneInput.saveGate.test.tsx.
describe('isUnofferedInternationalNumber', () => {
  it.each([
    ['+44 20 7946 0958', null, true],
    ['020 7946 0958', '+44', true],
    ['+49 30 123456', undefined, true],
    ['+44 20 79', null, false], // not a possible UK number
    ['+52 55 1234 5678', null, false], // Mexico is offered
    ['55 1234 5678', '+52', false],
    ['(303) 555-1234', '+1', false],
    ['(303) 555-1234', null, false], // no "+" and no code: nothing says it is foreign
    ['+44 20 7946 0958 ext 4', null, false], // non-phone text
    ['', '+44', false],
  ] as const)('%s / %s → %s', (value, countryCode, expected) => {
    expect(isUnofferedInternationalNumber(value, countryCode)).toBe(expected);
  });
});
