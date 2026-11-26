import { useState, type CSSProperties, type ReactElement } from 'react';
import {
  parseHue,
  hueGradientLight,
  hueGradientDark,
  gradientFromHexLight,
  gradientFromHexDark,
} from '@/lib/avatarHue';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Display name — drives initials, the gradient hash and the accessible label. */
  name?: string;
  /** Already-signed photo URL (backend `getSignedPhotoUrl`). */
  photoUrl?: string | null;
  /**
   * A member's chosen colour (`users.avatar_color`). A valid palette key or `hue:N` wins
   * over the name hash; null / undefined / an unknown key falls back to it.
   * Pass it for MEMBER avatars only: care-recipient avatars stay name-hashed.
   */
  colorKey?: string | null;
  size?: AvatarSize;
  /** 2px cream ring, for avatars sitting on a tinted/photographic ground. */
  bordered?: boolean;
  className?: string;
}

/**
 * Dimensions per size (spec §4.5: xs 28 · sm 36 · md 48 · lg 64 · xl 96).
 *
 * These are STATIC classes rather than an inline `style={{width,height}}` on
 * purpose: `Header.tsx` renders `<Avatar size="xs" className="h-8 w-8" />` and
 * relies on the class winning. An inline width/height beats any non-`!important`
 * class, so switching to inline px would silently shrink that avatar 32→28 in a
 * file this task may not edit. The class values below ARE the spec's px
 * (h-7 = 28, h-9 = 36, h-12 = 48, h-16 = 64, h-24 = 96).
 */
const sizeClass: Record<AvatarSize, string> = {
  xs: 'h-7 w-7',
  sm: 'h-9 w-9',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
  xl: 'h-24 w-24',
};

/** Initials size in px (spec §4.5: 12 / 14 / 18 / 24 / 36). Inline because
 *  arbitrary `text-[Npx]` utilities are banned outside Text/Button. */
const fontSizePx: Record<AvatarSize, number> = {
  xs: 12,
  sm: 14,
  md: 18,
  lg: 24,
  xl: 36,
};

/**
 * The six name-hashed gradient pairs, copied verbatim from mobile's canonical
 * palette (`mobile/src/components/ui/Avatar.tsx:44-51`) and expressed through
 * the web tokens that carry the identical hex:
 *
 *   [CC.moss #5C6B4E,      CC.mossInk #3A4832]   → moss / moss-deep
 *   [CC.coralDeep #B5453C, CC.terracottaDeep #8B3A2C] → coral-deep / terracotta-deep
 *   [CC.dusk #4A6073,      CC.duskDeep #3A4E5E]  → dusk / dusk-deep
 *   [CC.clay #8B5C32,      CC.clayDeep #865830]  → clay / clay-ramp-deep
 *   [CC.mossDeep #4A5940,  CC.mossDark #2C3826]  → moss-mid / moss-dark
 *   [CC.amberDeep #7E5620, CC.clayDeep #865830]  → amber-deep / clay-ramp-deep
 *
 * WCAG 1.4.3 (a11y audit 2026-09-29, same change as mobile's): the white
 * initials measured 4.12:1 on the old coral stop and 2.87:1 on the old
 * clay-light stop; every stop is now >= 5.4:1 against white.
 *
 * DARK MODE: the stops are the `--color-avatar-*` ROLE tokens, whose light
 * values are the hexes above and whose dark values are a muted ramp (the lifted
 * accent tints read as a highlighter on a 56px+ disc). Initials stay
 * `text-cream`, i.e. charcoal on those stops in dark (>= 4.8:1).
 *
 * (`--color-clay-deep` on web is #6E4825, a different value; mobile's
 * `CC.clayDeep` lives at `--color-clay-ramp-deep`. Likewise mobile's
 * `CC.mossDeep` is `--color-moss-mid`, since `--color-moss-deep` already
 * carries mobile's `mossInk`.)
 */
export const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ['var(--color-avatar-moss)', 'var(--color-avatar-moss-deep)'],
  ['var(--color-avatar-coral-deep)', 'var(--color-avatar-terracotta-deep)'],
  ['var(--color-avatar-dusk)', 'var(--color-avatar-dusk-deep)'],
  ['var(--color-avatar-clay)', 'var(--color-avatar-clay-deep)'],
  ['var(--color-avatar-moss-mid)', 'var(--color-avatar-moss-dark)'],
  ['var(--color-avatar-amber-deep)', 'var(--color-avatar-clay-deep)'],
] as const;

/**
 * Palette KEYS stored in `users.avatar_color` (backend CHECK constraint). Index
 * order == `AVATAR_GRADIENTS`, so a key and today's name hash agree.
 */
export const AVATAR_COLOR_KEYS = ['moss', 'coral', 'dusk', 'clay', 'forest', 'amber'] as const;
export type LegacyAvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number];

/**
 * 1.4.4: eight more quick-pick keys (fixed hex, white initial >= 4.5:1; twin of mobile's
 * AVATAR_EXTRA_COLORS). NOT part of the name-hash palette above, so nobody's hashed colour moves.
 */
export const AVATAR_EXTRA_COLORS = {
  sea: '#2E6B66',
  indigo: '#4B4F8F',
  plum: '#6E4A80',
  berry: '#8E3D60',
  rust: '#B0562A',
  ochre: '#7A6A1E',
  olive: '#55702E',
  slate: '#4A4742',
} as const;
export type ExtraAvatarColorKey = keyof typeof AVATAR_EXTRA_COLORS;
export type AvatarColorKey = LegacyAvatarColorKey | ExtraAvatarColorKey;

/** The 12 quick picks the picker OFFERS, in display order (same as mobile). forest / amber stay valid, not offered. */
export const AVATAR_QUICK_PICKS: readonly AvatarColorKey[] = [
  'moss',
  'sea',
  'dusk',
  'indigo',
  'plum',
  'berry',
  'coral',
  'rust',
  'clay',
  'ochre',
  'olive',
  'slate',
];

export function isAvatarColorKey(value: unknown): value is AvatarColorKey {
  return (
    typeof value === 'string' &&
    ((AVATAR_COLOR_KEYS as readonly string[]).includes(value) ||
      Object.prototype.hasOwnProperty.call(AVATAR_EXTRA_COLORS, value))
  );
}

/** A stored value the avatar can paint: a palette key or `hue:0-359`. Anything else falls back to the name hash. */
export function isValidAvatarColor(value: unknown): boolean {
  return isAvatarColorKey(value) || parseHue(value) !== null;
}

/**
 * Computed colours (extra keys, custom hues) paint through CSS variables so dark mode can swap them
 * (`.avatar-dyn` in globals.css picks the light or dark pair from `:root[data-theme]`).
 */
const DYN_FROM = 'var(--av-f)';
const DYN_TO = 'var(--av-t)';

/** The `--av-*` pairs an element needs for a computed colour; undefined for palette-token colours. */
export function avatarDynVars(colorKey?: string | null): CSSProperties | undefined {
  let light: readonly [string, string];
  let dark: readonly [string, string];
  if (typeof colorKey === 'string' && Object.prototype.hasOwnProperty.call(AVATAR_EXTRA_COLORS, colorKey)) {
    const hex = AVATAR_EXTRA_COLORS[colorKey as ExtraAvatarColorKey];
    light = gradientFromHexLight(hex);
    dark = gradientFromHexDark(hex);
  } else {
    const hue = parseHue(colorKey);
    if (hue === null) return undefined;
    light = hueGradientLight(hue);
    dark = hueGradientDark(hue);
  }
  return {
    '--av-lf': light[0],
    '--av-lt': light[1],
    '--av-df': dark[0],
    '--av-dt': dark[1],
  } as CSSProperties;
}

/** Gradient pair for a palette key (computed keys return the `--av-*` variable pair; see avatarDynVars). */
export function avatarGradientForKey(key: AvatarColorKey): readonly [string, string] {
  const i = (AVATAR_COLOR_KEYS as readonly string[]).indexOf(key);
  return i >= 0 ? AVATAR_GRADIENTS[i]! : [DYN_FROM, DYN_TO];
}

/**
 * Canonical gradient. A valid `colorKey` (the member's own choice) wins;
 * otherwise the name→gradient hash: a djb2-xor hash over every code point
 * of the trimmed name, modulo six, and gradient 0 when there is no name.
 *
 * DELIBERATE WEB-ONLY DIVERGENCE from mobile (approved 2026-10-02). Mobile
 * hashes only the FIRST character, so "Margaret" and "Sarah" both landed on
 * gradient 5. Do NOT "fix" this back to the first-character hash in a parity
 * sweep.
 */
export function avatarGradientFor(
  name?: string,
  colorKey?: string | null
): readonly [string, string] {
  if (isAvatarColorKey(colorKey)) return avatarGradientForKey(colorKey);
  if (parseHue(colorKey) !== null) return [DYN_FROM, DYN_TO];
  const trimmed = name?.trim();
  if (!trimmed) return AVATAR_GRADIENTS[0]!;
  let h = 5381;
  for (const ch of trimmed) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
}

/** First letter of the first + last name token (e.g. "Rose Meza" → "RM"). */
function initialsFor(name?: string): string {
  // ONE initial, like mobile (Avatar.tsx: `name?.charAt(0).toUpperCase() || '?'`).
  return name?.trim().charAt(0).toUpperCase() || '?';
}

/**
 * Circular avatar mirroring mobile: renders the (already-signed) photo when
 * present, otherwise white initials on the name's 135° gradient. Falls back to
 * initials gracefully if the image fails to load.
 *
 * Recipient photo URLs arrive pre-signed from the backend; CSP `img-src`
 * already allows `*.supabase.co`.
 */
export function Avatar({
  name,
  photoUrl,
  colorKey,
  size = 'md',
  bordered = false,
  className,
}: AvatarProps): ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(photoUrl) && !imageFailed;

  const ring = bordered ? ' ring-2 ring-cream' : '';
  const base = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full${ring}`;
  const dimensions = sizeClass[size];

  if (showImage) {
    // The native <img alt> carries the accessible name; the wrapper stays
    // presentational so there is exactly one `img` in the a11y tree.
    return (
      <span className={`${base} ${dimensions} bg-bg-2${className ? ` ${className}` : ''}`}>
        <img
          src={photoUrl ?? undefined}
          alt={name ?? ''}
          loading="lazy"
          onError={() => setImageFailed(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }

  const [from, to] = avatarGradientFor(name, colorKey);

  // Initials fallback. Decorative: the surrounding row already names the
  // member, so the glyphs carry no independent meaning.
  return (
    <span
      aria-hidden="true"
      className={`${base} ${dimensions} avatar-dyn font-semibold text-cream${className ? ` ${className}` : ''}`}
      style={{
        ...avatarDynVars(colorKey),
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        fontSize: fontSizePx[size],
      }}
    >
      {initialsFor(name)}
    </span>
  );
}
