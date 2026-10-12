import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';

// Same sanity check mobile uses before opening tel: URLs
// (mobile/src/screens/emergency/EmergencyInfoScreen.tsx).
const PHONE_RE = /^[\d\s\-+().]+$/;

/**
 * Build a `tel:` href from a stored phone + optional country code
 * (e.g. "+1", "+52"). Returns null when the value doesn't look like a
 * dialable number — the caller renders plain text instead.
 */
export function telHref(phone: string, countryCode?: string | null): string | null {
  if (!phone || !PHONE_RE.test(phone)) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (!digits.replace(/\D/g, '')) return null;
  const prefix =
    countryCode && !digits.startsWith('+') ? countryCode.replace(/[^\d+]/g, '') : '';
  return `tel:${prefix}${digits}`;
}

export interface PhoneLinkProps {
  phone: string;
  countryCode?: string | null;
  /** Accessible label, e.g. "Call Dr. Chen". */
  ariaLabel?: string;
  /** Optional extension digits; shown after the number, never part of the `tel:` href. */
  extension?: string | null;
}

/**
 * Phone number rendered as a tel: link (life-critical info — one tap/click to
 * dial). A `call-outline` glyph marks it as a tappable affordance, mirroring
 * mobile's call buttons (spec §6.6). Falls back to plain text when the
 * number isn't dialable.
 */
export function PhoneLink({
  phone,
  countryCode,
  ariaLabel,
  extension,
}: PhoneLinkProps): ReactElement {
  const { t } = useTranslation('emergency');
  const href = telHref(phone, countryCode);
  const display = countryCode ? `${countryCode} ${phone}` : phone;

  // "<phone> ext. <digits>": the visible text is the short form; assistive tech
  // gets the spelled-out "extension <digits>" (the short form is hidden from it).
  // The extension sits OUTSIDE the link: tapping dials the main number only.
  const ext = extension ? (
    <span className="text-ink">
      <span aria-hidden="true">{t('phone.extensionShort', { ext: extension })}</span>
      <span className="sr-only">{t('phone.extensionAria', { ext: extension })}</span>
    </span>
  ) : null;

  if (!href) {
    return (
      <span className="text-ink">
        {display}
        {ext ? <> {ext}</> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex min-h-[44px] flex-wrap items-center gap-x-1.5">
      <a
        href={href}
        aria-label={ariaLabel}
        className="inline-flex min-h-[44px] items-center gap-1.5 font-medium text-terracotta-deep"
      >
        <Icon name="call-outline" size="inline" />
        {display}
      </a>
      {ext}
    </span>
  );
}
