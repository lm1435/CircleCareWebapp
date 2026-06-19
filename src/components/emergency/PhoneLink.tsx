import type { ReactElement } from 'react';

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
}

/**
 * Inline phone/call glyph (decorative — the link's aria-label names the call
 * target). Mirrors mobile's `call-outline` Ionicon next to dialable numbers.
 */
function CallGlyph(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

/**
 * Phone number rendered as a tel: link (life-critical info — one tap/click to
 * dial). A call glyph marks it as a tappable affordance, mirroring mobile's
 * call buttons. Falls back to plain text when the number isn't dialable.
 */
export function PhoneLink({ phone, countryCode, ariaLabel }: PhoneLinkProps): ReactElement {
  const href = telHref(phone, countryCode);
  const display = countryCode ? `${countryCode} ${phone}` : phone;

  if (!href) {
    return <span className="text-ink">{display}</span>;
  }

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1.5 font-medium text-terracotta-deep underline underline-offset-2 hover:text-ink"
    >
      <CallGlyph />
      {display}
    </a>
  );
}
