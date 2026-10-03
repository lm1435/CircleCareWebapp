import { useState, type ReactElement } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Display name — drives initials, the gradient hash and the accessible label. */
  name?: string;
  /** Already-signed photo URL (backend `getSignedPhotoUrl`). */
  photoUrl?: string | null;
  /**
   * A member's chosen colour (`users.avatar_color`). A valid palette key wins
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
 * (`--color-clay-deep` on web is #6E4825, a different value; mobile's
 * `CC.clayDeep` lives at `--color-clay-ramp-deep`. Likewise mobile's
 * `CC.mossDeep` is `--color-moss-mid`, since `--color-moss-deep` already
 * carries mobile's `mossInk`.)
 */
export const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ['var(--color-moss)', 'var(--color-moss-deep)'],
  ['var(--color-coral-deep)', 'var(--color-terracotta-deep)'],
  ['var(--color-dusk)', 'var(--color-dusk-deep)'],
  ['var(--color-clay)', 'var(--color-clay-ramp-deep)'],
  ['var(--color-moss-mid)', 'var(--color-moss-dark)'],
  ['var(--color-amber-deep)', 'var(--color-clay-ramp-deep)'],
] as const;

/**
 * Palette KEYS stored in `users.avatar_color` (backend CHECK constraint). Index
 * order == `AVATAR_GRADIENTS`, so a key and today's name hash agree.
 */
export const AVATAR_COLOR_KEYS = ['moss', 'coral', 'dusk', 'clay', 'forest', 'amber'] as const;
export type AvatarColorKey = (typeof AVATAR_COLOR_KEYS)[number];

export function isAvatarColorKey(value: unknown): value is AvatarColorKey {
  return typeof value === 'string' && (AVATAR_COLOR_KEYS as readonly string[]).includes(value);
}

/** Gradient pair for a palette key. */
export function avatarGradientForKey(key: AvatarColorKey): readonly [string, string] {
  return AVATAR_GRADIENTS[AVATAR_COLOR_KEYS.indexOf(key)]!;
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
      className={`${base} ${dimensions} font-semibold text-cream${className ? ` ${className}` : ''}`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${from}, ${to})`,
        fontSize: fontSizePx[size],
      }}
    >
      {initialsFor(name)}
    </span>
  );
}
