import { useState, type ReactElement } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Display name — drives initials, the gradient hash and the accessible label. */
  name?: string;
  /** Already-signed photo URL (backend `getSignedPhotoUrl`). */
  photoUrl?: string | null;
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
 *   [CC.coral #C65D54,     CC.coralDeep #B5453C] → coral / coral-deep
 *   [CC.dusk #4A6073,      CC.duskDeep #3A4E5E]  → dusk / dusk-deep
 *   [CC.clay #8B5C32,      CC.clayDeep #865830]  → clay / clay-ramp-deep
 *   [CC.mossDeep #4A5940,  CC.mossDark #2C3826]  → moss-mid / moss-dark
 *   [CC.clayLight #C48D5E, CC.clay #8B5C32]      → clay-light / clay
 *
 * (`--color-clay-deep` on web is #6E4825, a different value; mobile's
 * `CC.clayDeep` lives at `--color-clay-ramp-deep`. Likewise mobile's
 * `CC.mossDeep` is `--color-moss-mid`, since `--color-moss-deep` already
 * carries mobile's `mossInk`.)
 */
export const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ['var(--color-moss)', 'var(--color-moss-deep)'],
  ['var(--color-coral)', 'var(--color-coral-deep)'],
  ['var(--color-dusk)', 'var(--color-dusk-deep)'],
  ['var(--color-clay)', 'var(--color-clay-ramp-deep)'],
  ['var(--color-moss-mid)', 'var(--color-moss-dark)'],
  ['var(--color-clay-light)', 'var(--color-clay)'],
] as const;

/**
 * Canonical name→gradient hash. Mirrors mobile exactly: the FIRST character's
 * code point modulo six, and gradient 0 when there is no name.
 */
export function avatarGradientFor(name?: string): readonly [string, string] {
  if (!name) return AVATAR_GRADIENTS[0]!;
  const charCode = name.charCodeAt(0) || 0;
  return AVATAR_GRADIENTS[charCode % AVATAR_GRADIENTS.length]!;
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

  const [from, to] = avatarGradientFor(name);

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
