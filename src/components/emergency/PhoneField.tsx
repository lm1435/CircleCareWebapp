import {
  forwardRef,
  useImperativeHandle,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { CountryCode } from 'libphonenumber-js/min';
import { Select, TextField } from '@/components/ui';
import {
  DEFAULT_PHONE_COUNTRY_ISO2,
  PHONE_COUNTRIES,
  digitsOf,
  findPhoneCountryByIso2,
  formatNational,
  isUnofferedInternationalNumber,
  phoneNumberBlocksSave,
  resolveSeed,
  storedPhone,
} from '@/lib/phone';

export interface PhoneFieldProps {
  /** Id of the tel input; the country select is `${id}-country`. */
  id: string;
  label: ReactNode;
  /** Stored `phone` (formatted national number, or a legacy value). */
  value: string;
  /** Stored `country_code` ("+52"), if any. */
  countryCode?: string | null;
  /** Emits `(formatted national number, "+NN")` — the stored shape. */
  onChange: (phone: string, countryCode: string) => void;
  required?: boolean;
  /** Caller-owned error (e.g. "required"); wins over the format hint. */
  error?: string;
}

export interface PhoneFieldHandle {
  /**
   * THE SAVE GATE (owner decision, iOS build 31: a too-long doctor number
   * showed "Enter a valid phone number" and saved anyway). `true` = the form
   * may save. `false` = it must not: the inline error is forced visible
   * (`aria-invalid` + `aria-describedby` via TextField) and focus moves to the
   * number, scrolled into view — a screen reader reads the field with its
   * error. The verdict is the SAME check the inline error uses
   * (`phoneNumberBlocksSave`), on the field's own state. Empty is always
   * `true`: whether a phone is required is the form's rule, not this one's.
   * Mobile twin: `PhoneInputHandle` in components/common/PhoneInput.tsx.
   */
  validateForSave: () => boolean;
}

/**
 * A LITERAL key per country (not `t(\`phone.countries.${iso2}\`)`), so
 * `translationKeys.test.ts` statically verifies all 23 in EN and ES instead of
 * adding a dynamic call site to its pinned count. Same choice as mobile.
 */
function countryName(t: TFunction<'emergency'>, iso2: string): string {
  switch (iso2) {
    case 'US': return t('phone.countries.US');
    case 'CA': return t('phone.countries.CA');
    case 'MX': return t('phone.countries.MX');
    case 'PR': return t('phone.countries.PR');
    case 'DO': return t('phone.countries.DO');
    case 'GT': return t('phone.countries.GT');
    case 'HN': return t('phone.countries.HN');
    case 'SV': return t('phone.countries.SV');
    case 'NI': return t('phone.countries.NI');
    case 'CR': return t('phone.countries.CR');
    case 'PA': return t('phone.countries.PA');
    case 'CO': return t('phone.countries.CO');
    case 'VE': return t('phone.countries.VE');
    case 'EC': return t('phone.countries.EC');
    case 'PE': return t('phone.countries.PE');
    case 'BO': return t('phone.countries.BO');
    case 'CL': return t('phone.countries.CL');
    case 'AR': return t('phone.countries.AR');
    case 'UY': return t('phone.countries.UY');
    case 'PY': return t('phone.countries.PY');
    case 'BR': return t('phone.countries.BR');
    case 'ES': return t('phone.countries.ES');
    case 'CU': return t('phone.countries.CU');
    default: return iso2;
  }
}

/**
 * Phone number with a country picker — the web twin of mobile's
 * `components/common/PhoneInput.tsx`: same 23 countries in the same order,
 * same stored shape (`phone` = live-formatted national number via
 * libphonenumber-js `AsYouType`, `country_code` = "+NN"), same seeding rules
 * (`resolveSeed` in `@/lib/phone`).
 *
 * The country is a labelled native `<select>` (the app's `Select`), so it is
 * keyboard operable with type-ahead on the localized name, and the number is
 * the app's `TextField` — both carry their own visible label and the shared
 * focus border.
 *
 * SEEDS ONCE: the stored pair seeds the field on mount, and a later prop is
 * adopted only while the field is still pristine and empty (a record that
 * arrives after mount — the mobile hydration bug). After that the component
 * owns its state; props echoed back from `onChange` never fight typing.
 * Seeding never calls `onChange`.
 *
 * Format is a SAVE BLOCKER — same as mobile: a possible-LENGTH check for the
 * selected country (`phoneNumberBlocksSave`), enforced by the form through
 * {@link PhoneFieldHandle}. The error shows as soon as the form opens for a
 * stored number that fails it, after blur / a country pick for one the user
 * changed, and always after a refused Save.
 */
export const PhoneField = forwardRef<PhoneFieldHandle, PhoneFieldProps>(function PhoneField(
  { id, label, value, countryCode, onChange, required, error },
  ref
) {
  const { t } = useTranslation('emergency');
  const defaultIso2 = DEFAULT_PHONE_COUNTRY_ISO2;

  const [initialSeed] = useState(() => resolveSeed(value, countryCode, defaultIso2));
  const [iso2, setIso2] = useState<CountryCode>(initialSeed.iso2 ?? defaultIso2);
  const [nationalDigits, setNationalDigits] = useState(initialSeed.digits);
  // WHEN THE ERROR SHOWS. It is a save blocker now (see `PhoneFieldHandle`),
  // so it is never hidden from a user who is about to be refused:
  // - a number still exactly as it was SEEDED (the stored record) is judged the
  //   moment the form opens — no blur needed — unless it is exempt (required
  //   field / un-offered country, see `phoneNumberBlocksSave`);
  // - a number the user has CHANGED is judged once they commit the edit (leave
  //   the number, or pick a country). The next keystroke disarms it again, so a
  //   user mid-correction isn't nagged while typing;
  // - a refused Save (`validateForSave`) forces it visible either way.
  const [seeded, setSeeded] = useState(() => ({
    digits: initialSeed.digits,
    iso2: initialSeed.iso2 ?? defaultIso2,
    unoffered: isUnofferedInternationalNumber(value, countryCode),
  }));
  const [hintArmed, setHintArmed] = useState(false);
  const [saveRefused, setSaveRefused] = useState(false);

  // The one exception to seed-once: a record arriving while pristine + empty.
  // Adjusted during render (React's "state from changed props" pattern), not
  // in an effect, so the number appears in the same commit.
  const [userEdited, setUserEdited] = useState(false);
  const [seenValue, setSeenValue] = useState(value);
  const [seenCountryCode, setSeenCountryCode] = useState(countryCode);
  if (value !== seenValue || countryCode !== seenCountryCode) {
    setSeenValue(value);
    setSeenCountryCode(countryCode);
    if (!userEdited && nationalDigits === '') {
      const seed = resolveSeed(value, countryCode, defaultIso2);
      if (seed.iso2) setIso2(seed.iso2);
      setNationalDigits(seed.digits);
      setSeeded({
        digits: seed.digits,
        iso2: seed.iso2 ?? iso2,
        unoffered: isUnofferedInternationalNumber(value, countryCode),
      });
    }
  }

  const country = findPhoneCountryByIso2(iso2) ?? PHONE_COUNTRIES[0];
  const displayValue = formatNational(nationalDigits, iso2);

  const handlePhoneChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const text = event.target.value;
    setUserEdited(true);
    setHintArmed(false);
    setSaveRefused(false);

    // A pasted international number ("+52 55 1234 5678") picks its own
    // country when it is one the picker offers.
    if (text.trim().startsWith('+')) {
      const seed = resolveSeed(text, undefined, iso2);
      const pasted = findPhoneCountryByIso2(seed.iso2);
      if (pasted) {
        setIso2(pasted.iso2);
        setNationalDigits(seed.digits);
        onChange(storedPhone(seed.digits, pasted.iso2), pasted.callingCode);
        return;
      }
    }

    let digits = digitsOf(text).slice(0, 15);
    // THE BACKSPACE TRAP (same as mobile): deleting the ")" AsYouType just
    // added to "(555)" leaves the digits unchanged, so re-formatting would put
    // it straight back and backspace would never get past the area code.
    // Shorter text + same digits = a formatting char was deleted → drop a digit.
    if (text.length < displayValue.length && digits === nationalDigits) {
      digits = digits.slice(0, -1);
    }
    setNationalDigits(digits);
    onChange(storedPhone(digits, iso2), country.callingCode);
  };

  const handleCountryChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const next = findPhoneCountryByIso2(event.target.value);
    if (!next) return;
    setUserEdited(true);
    setHintArmed(true);
    setIso2(next.iso2);
    onChange(storedPhone(nationalDigits, next.iso2), next.callingCode);
  };

  // The inline error AND the save gate share one verdict — a LENGTH check
  // (`isPossibleForCountry`), not `isValid`; see its doc.
  const changed = nationalDigits !== seeded.digits || iso2 !== seeded.iso2;
  const blocksSave = phoneNumberBlocksSave({
    digits: nationalDigits,
    iso2,
    changed,
    required: Boolean(required),
    seededUnoffered: seeded.unoffered,
  });
  const showInvalid = blocksSave && (!changed || hintArmed || saveRefused);
  const fieldError = error ?? (showInvalid ? t('phone.invalid') : undefined);

  useImperativeHandle(
    ref,
    () => ({
      validateForSave: () => {
        if (!blocksSave) return true;
        setSaveRefused(true);
        const input = document.getElementById(id);
        input?.focus();
        // `focus()` only scrolls as far as it must; centre it so the error line
        // under the input is on screen too. Optional call: jsdom has none.
        input?.scrollIntoView?.({ block: 'center' });
        return false;
      },
    }),
    [blocksSave, id]
  );

  return (
    // WRAP, NOT A BREAKPOINT. Country and number sit side by side only when
    // the country column's full width (`basis-[17.5rem]`) AND a usable number
    // column (`basis-[11rem]`) both fit the modal's content box; otherwise the
    // row wraps and each takes the full width (country above phone). On one
    // line the number soaks up the extra space (grow 999 vs 1), so the country
    // column stays ~17.5rem.
    //
    // 17.5rem = 280px, MEASURED in Chromium (Edit contact/doctor/insurance,
    // 1280px): the widest option label is "República Dominicana (+1)" at 202px
    // (EN: "Dominican Republic (+1)", 184px), and the shell spends ~55px on its
    // padding, chevron and gap — so ≥257px shows every label whole; the rest
    // is slack for font fallback. The three modals are `size="lg"` so the
    // number still gets ~330px beside it. `min-w-0` + the select's ellipsis are
    // the fallback on a viewport narrower than the column itself.
    //
    // Labels stay "Name (+NN)", not "+NN · Name": a native select's type-ahead
    // matches the START of the option text, so a code-first label would break
    // typing "M" for México — and five options share "+1" anyway.
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 grow basis-[17.5rem]">
        <Select
          id={`${id}-country`}
          label={t('phone.countryLabel')}
          value={country.iso2}
          onChange={handleCountryChange}
          autoComplete="tel-country-code"
          className="overflow-hidden text-ellipsis whitespace-nowrap"
          options={PHONE_COUNTRIES.map((c) => ({
            value: c.iso2,
            label: `${countryName(t, c.iso2)} (${c.callingCode})`,
          }))}
        />
      </div>
      <div className="min-w-0 grow-[999] basis-[11rem]">
        <TextField
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          label={label}
          required={required}
          value={displayValue}
          error={fieldError}
          onChange={handlePhoneChange}
          onBlur={() => setHintArmed(true)}
        />
      </div>
    </div>
  );
});
