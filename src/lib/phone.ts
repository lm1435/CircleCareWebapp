/**
 * Phone country list + stored-value inference — a port of mobile's
 * `components/common/phoneCountries.ts` and `PhoneInput.tsx`'s `resolveSeed`
 * (not imported across packages; keep the two in step by hand).
 *
 * STORED SHAPE (unchanged, shared with mobile and the backend Zod):
 *   `phone`        — the live-formatted NATIONAL number, e.g. "55 1234 5678"
 *                    (`z.string().max(20)`)
 *   `country_code` — the calling code with a leading "+", e.g. "+52"
 *                    (`z.string().max(5)`)
 * Neither is E.164.
 */
import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/min';

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2, and the `CountryCode` libphonenumber-js expects. */
  iso2: CountryCode;
  /** Calling code with a leading "+", e.g. "+1". */
  callingCode: string;
}

/** Same 23 countries, same order, as mobile's picker. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { iso2: 'US', callingCode: '+1' },
  { iso2: 'CA', callingCode: '+1' },
  { iso2: 'MX', callingCode: '+52' },
  { iso2: 'PR', callingCode: '+1' },
  { iso2: 'DO', callingCode: '+1' },
  { iso2: 'GT', callingCode: '+502' },
  { iso2: 'HN', callingCode: '+504' },
  { iso2: 'SV', callingCode: '+503' },
  { iso2: 'NI', callingCode: '+505' },
  { iso2: 'CR', callingCode: '+506' },
  { iso2: 'PA', callingCode: '+507' },
  { iso2: 'CO', callingCode: '+57' },
  { iso2: 'VE', callingCode: '+58' },
  { iso2: 'EC', callingCode: '+593' },
  { iso2: 'PE', callingCode: '+51' },
  { iso2: 'BO', callingCode: '+591' },
  { iso2: 'CL', callingCode: '+56' },
  { iso2: 'AR', callingCode: '+54' },
  { iso2: 'UY', callingCode: '+598' },
  { iso2: 'PY', callingCode: '+595' },
  { iso2: 'BR', callingCode: '+55' },
  { iso2: 'ES', callingCode: '+34' },
  { iso2: 'CU', callingCode: '+53' },
];

export const DEFAULT_PHONE_COUNTRY_ISO2: CountryCode = 'US';

/** Backend `phone` max length. */
export const PHONE_MAX_LENGTH = 20;

/** E.164 caps a full number at 15 digits; a national number can't exceed it. */
const MAX_NATIONAL_DIGITS = 15;

/** The same sanity check PhoneLink uses before building a tel: href. */
const PHONE_CHARS_RE = /^[\d\s\-+().]+$/;

export function findPhoneCountryByIso2(iso2: string | undefined | null): PhoneCountry | undefined {
  if (!iso2) return undefined;
  const upper = iso2.toUpperCase();
  return PHONE_COUNTRIES.find((c) => c.iso2 === upper);
}

/** FIRST country with this calling code — "+1" is shared, so it is the US. */
export function findPhoneCountryByCallingCode(
  callingCode: string | undefined | null
): PhoneCountry | undefined {
  if (!callingCode) return undefined;
  return PHONE_COUNTRIES.find((c) => c.callingCode === callingCode);
}

export function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

function stripLeadingCallingCode(digits: string, callingCode: string): string {
  const cc = digitsOf(callingCode);
  if (cc && digits.length > cc.length && digits.startsWith(cc)) return digits.slice(cc.length);
  return digits;
}

function supportedIso2(country: string | undefined): CountryCode | undefined {
  return findPhoneCountryByIso2(country)?.iso2;
}

export function isValidForCountry(digits: string, iso2: CountryCode): boolean {
  if (!digits) return true;
  const parsed = parsePhoneNumberFromString(digits, iso2);
  return !!parsed && parsed.isValid();
}

/**
 * The USER-FACING hint check: is this a POSSIBLE length for the country?
 *
 * Deliberately not {@link isValidForCountry}. `isValid` also requires an
 * assigned area code / range, so a fictional "(555) 111-2222" — all over demo
 * and test data — was flagged "Enter a valid phone number", and a legitimately
 * new area code the bundled /min metadata doesn't know yet would be too. The
 * hint exists to catch a dropped or extra digit, and length is what says that.
 * `resolveSeed` / `initialPhoneValue` keep using `isValid` on purpose: there it
 * decides country INFERENCE, where "could be any country's length" is useless.
 */
export function isPossibleForCountry(digits: string, iso2: CountryCode): boolean {
  if (!digits) return true;
  const parsed = parsePhoneNumberFromString(digits, iso2);
  return !!parsed && parsed.isPossible();
}

export function formatNational(digits: string, iso2: CountryCode): string {
  if (!digits) return '';
  return new AsYouType(iso2).input(digits);
}

export interface PhoneSeed {
  /** National digits. */
  digits: string;
  /** The country the record says, or undefined = unknown (keep the default). */
  iso2: CountryCode | undefined;
}

/**
 * What a stored `phone`/`country_code` pair seeds the field with. Pure; mirrors
 * mobile's `resolveSeed` rule for rule:
 *
 * 1. Known calling code: strip it if baked into the value; a SHARED code
 *    ("+1") is refined by the number itself (416 → CA, 787 → PR, 809 → DO).
 * 2. No usable code: a "+"-prefixed value is parsed as international.
 *    Unprefixed digits are reinterpreted only when ≥11 digits, invalid for the
 *    default country, and VALID for an offered country (a 10-digit US-shaped
 *    string is never reread as foreign).
 * 3. Otherwise: no country, "+1" stripped if it leads (the old behavior).
 */
export function resolveSeed(
  value: string | null | undefined,
  countryCode: string | null | undefined,
  defaultIso2: CountryCode
): PhoneSeed {
  const byCallingCode = findPhoneCountryByCallingCode(countryCode);
  const trimmed = (value || '').trim();
  if (!trimmed) return { digits: '', iso2: byCallingCode?.iso2 };

  const rawDigits = digitsOf(trimmed);

  if (byCallingCode) {
    const cc = byCallingCode.callingCode;
    const digits = stripLeadingCallingCode(rawDigits, cc);
    let iso2 = byCallingCode.iso2;
    const shared = PHONE_COUNTRIES.filter((c) => c.callingCode === cc).length > 1;
    if (shared && digits) {
      const inferred = supportedIso2(parsePhoneNumberFromString(`${cc}${digits}`)?.country);
      if (inferred) iso2 = inferred;
    }
    return { digits, iso2 };
  }

  if (trimmed.startsWith('+')) {
    const parsed = parsePhoneNumberFromString(trimmed);
    const inferred = supportedIso2(parsed?.country);
    if (parsed && inferred) return { digits: parsed.nationalNumber, iso2: inferred };
  } else {
    const fallbackDigits = stripLeadingCallingCode(rawDigits, '+1');
    if (rawDigits.length >= 11 && !isValidForCountry(fallbackDigits, defaultIso2)) {
      const parsed = parsePhoneNumberFromString(`+${rawDigits}`);
      const inferred = supportedIso2(parsed?.country);
      if (parsed && inferred && parsed.isValid()) {
        return { digits: parsed.nationalNumber, iso2: inferred };
      }
    }
  }

  return { digits: stripLeadingCallingCode(rawDigits, '+1'), iso2: undefined };
}

/** The value a field emits: formatted national number, capped for the backend. */
export function storedPhone(digits: string, iso2: CountryCode): string {
  const capped = digits.slice(0, MAX_NATIONAL_DIGITS);
  const formatted = formatNational(capped, iso2);
  return formatted.length <= PHONE_MAX_LENGTH ? formatted : capped;
}

export interface PhoneValue {
  phone: string;
  countryCode: string | null;
}

/**
 * What an edit modal holds (and saves, if the user never touches the phone)
 * for a stored record. The web saves `country_code` alongside `phone` whenever
 * it can say which country the number belongs to:
 *
 * - resolvable (a known code, or inference per `resolveSeed`), or a no-code
 *   number that is a VALID number of the default country → normalized to the
 *   field's own shape (formatted national + "+NN"), exactly what the field
 *   would emit on the first keystroke;
 * - anything else — a country the picker doesn't offer ("+44 …"), or a value
 *   carrying non-phone text ("ext 4") → kept VERBATIM with its original code.
 *   Rewriting "+44 20 7946 0958" as a +1 number would turn a correct tel: link
 *   into a wrong one; the user has to pick a country to change it.
 */
export function initialPhoneValue(
  phone: string | null | undefined,
  countryCode: string | null | undefined,
  defaultIso2: CountryCode = DEFAULT_PHONE_COUNTRY_ISO2
): PhoneValue {
  const trimmed = (phone ?? '').trim();
  if (!trimmed) return { phone: '', countryCode: null };
  const verbatim: PhoneValue = { phone: trimmed, countryCode: countryCode || null };
  if (!PHONE_CHARS_RE.test(trimmed)) return verbatim;

  const seed = resolveSeed(trimmed, countryCode, defaultIso2);
  const iso2 =
    seed.iso2 ??
    (!countryCode && isValidForCountry(seed.digits, defaultIso2) ? defaultIso2 : undefined);
  const country = findPhoneCountryByIso2(iso2);
  if (!country || !seed.digits) return verbatim;
  return { phone: storedPhone(seed.digits, country.iso2), countryCode: country.callingCode };
}
