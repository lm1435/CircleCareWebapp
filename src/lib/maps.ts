// "Open this address in Maps": a plain outbound link, no geocoding, no key, no
// embedded map. Google Maps everywhere except Apple devices, which get Apple
// Maps. Mirrors mobile (same URL forms, same rule for what counts as a place).

/** True on iPhone, iPad and Mac (incl. iPadOS 13+, which reports as a Mac). */
type NavLike = { userAgent?: string; platform?: string };

export function isAppleDevice(
  nav: NavLike | undefined = typeof navigator === 'undefined' ? undefined : navigator
): boolean {
  if (!nav) return false;
  const platform = nav.platform ?? '';
  const ua = nav.userAgent ?? '';
  return /^(Mac|iPhone|iPad|iPod)/i.test(platform) || /iPhone|iPad|iPod|Macintosh/i.test(ua);
}

/** Trim each line, collapse inner whitespace, join the non-empty lines with ", " (as mobile does). */
export function singleLineAddress(value: string | null | undefined): string {
  return (value ?? '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
}

const VIRTUAL_START =
  /^(https?:\/\/|zoom|teams|meet|webex|skype|facetime|virtual|online|remote|call|dial|telehealth)/i;
const VIRTUAL_HOST = /\.(zoom|teams|webex|com|us|io)\b/i;

/**
 * Appointment / task LOCATIONS are free text. A location is a maps link unless
 * it is empty or looks virtual (same rule as mobile's calendar). Doctor
 * ADDRESS fields do not use this: they are links unless empty.
 */
export function isMapsOpenable(location: string | null | undefined): boolean {
  const t = (location ?? '').trim();
  if (!t) return false;
  return !VIRTUAL_START.test(t) && !VIRTUAL_HOST.test(t);
}

/** Maps URL for a saved address / location, or null when it is empty. */
export function mapsUrl(
  value: string | null | undefined,
  apple: boolean = isAppleDevice()
): string | null {
  const line = singleLineAddress(value);
  if (!line) return null;
  const q = encodeURIComponent(line);
  return apple
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
}
