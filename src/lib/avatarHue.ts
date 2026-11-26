/**
 * Member colour, 1.4.4: custom hue + the extra quick picks.
 *
 * Storage: `users.avatar_color` is text. A custom hue is `hue:<0-359>` (integer, no sign, no leading
 * zeros); quick picks are palette KEYS. The mobile twin is mobile/src/utils/avatarHue.ts: keep the two in step.
 *
 * Light theme: the gradient carries a WHITE initial. Saturation is fixed (0.45); lightness is
 * deterministic per hue: start at 0.40 and step down until white-on-fill is >= 4.6:1 (WCAG 1.4.3 needs
 * 4.5). The gradient's SECOND stop is darker still, so the first stop (where the letter's left edge sits)
 * is the binding one. Dark theme: a muted, lighter ramp that carries the DARK initial (#232019, web's dark --color-cream; mobile uses #14130F), same
 * per-hue search, >= 4.6:1.
 */

export const HUE_PREFIX = 'hue:';
export const HUE_STEP = 15;

const HUE_RE = /^hue:(?:[0-9]|[1-9][0-9]|[12][0-9]{2}|3[0-5][0-9])$/;

/** `hue:N` -> N (0-359), else null. Strict: no sign, no decimals, no leading zeros, no whitespace. */
export function parseHue(value: unknown): number | null {
  if (typeof value !== 'string' || !HUE_RE.test(value)) return null;
  return Number(value.slice(HUE_PREFIX.length));
}

export function formatHue(hue: number): string {
  return `${HUE_PREFIX}${((Math.round(hue) % 360) + 360) % 360}`;
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const HUE_SATURATION = 0.45;
const LIGHT_INITIAL = '#FFFFFF';
export const DARK_INITIAL = '#232019';
const TARGET = 4.6;

/** Light-theme gradient for a hue: first stop carries the white initial at >= 4.6:1. */
export function hueGradientLight(hue: number): [string, string] {
  let l = 0.4;
  let top = hslToHex(hue, HUE_SATURATION, l);
  while (contrastRatio(LIGHT_INITIAL, top) < TARGET && l > 0.1) {
    l -= 0.005;
    top = hslToHex(hue, HUE_SATURATION, l);
  }
  return [top, hslToHex(hue, HUE_SATURATION, Math.max(0.08, l - 0.08))];
}

/** Dark-theme gradient from any hue: muted, lighter, carries the DARK initial at >= 4.6:1. */
export function darkGradientForHue(hue: number): [string, string] {
  let l = 0.56;
  let top = hslToHex(hue, 0.18, l);
  while (contrastRatio(DARK_INITIAL, top) < TARGET && l < 0.85) {
    l += 0.005;
    top = hslToHex(hue, 0.18, l);
  }
  return [top, hslToHex(hue, 0.18, Math.min(0.9, l + 0.1))];
}

export function hueGradientDark(hue: number): [string, string] {
  return darkGradientForHue(hue);
}

/** Light gradient for a fixed quick-pick hex: the hex itself, then a darker stop. */
export function gradientFromHexLight(hex: string): [string, string] {
  const { h, s, l } = hexToHsl(hex);
  return [hex, hslToHex(h, s, Math.max(0.08, l - 0.07))];
}

export function gradientFromHexDark(hex: string): [string, string] {
  return darkGradientForHue(hexToHsl(hex).h);
}

/** Rough colour band for a hue (not shown to users: the slider's accessibilityValue is "Hue N degrees"). */
export const HUE_BANDS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type HueBand = (typeof HUE_BANDS)[number];
export function hueBand(hue: number): HueBand {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 45) return 'orange';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  if (h < 200) return 'teal';
  if (h < 255) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}
