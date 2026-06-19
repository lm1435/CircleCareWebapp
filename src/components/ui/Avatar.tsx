import { useState, type ReactElement } from 'react';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps {
  /** Display name — drives initials and the accessible label. */
  name?: string;
  /** Already-signed photo URL (backend `getSignedPhotoUrl`). */
  photoUrl?: string | null;
  size?: AvatarSize;
  className?: string;
}

// Dimension + text utility classes per size. Mirrors mobile's xs–xl scale
// (mobile/src/components/ui/Avatar.tsx) adapted to the web type ramp.
const sizeClass: Record<AvatarSize, string> = {
  xs: 'h-7 w-7 text-xs',
  sm: 'h-9 w-9 text-sm',
  md: 'h-12 w-12 text-base',
  lg: 'h-16 w-16 text-xl',
  xl: 'h-24 w-24 text-3xl',
};

// Deterministic soft-tint surfaces, mirroring mobile's gradient-initials feel
// with our section tokens (moss / dusk / clay / terracotta). Token classes
// only — no hardcoded hex.
const tintClass = [
  'bg-moss-soft text-moss-deep',
  'bg-dusk-soft text-dusk-deep',
  'bg-clay-soft text-clay-deep',
  'bg-terracotta-soft text-terracotta-deep',
] as const;

/** Stable hash so the same name always maps to the same tint. */
function tintForName(name?: string): string {
  if (!name) return tintClass[0];
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return tintClass[hash % tintClass.length];
}

/** First letter of the first + last name token (e.g. "Rose Meza" → "RM"). */
function initialsFor(name?: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/**
 * Circular avatar mirroring mobile: renders the (already-signed) photo when
 * present, otherwise initials on a deterministic soft-tinted surface. Falls
 * back to initials gracefully if the image fails to load.
 *
 * Recipient photo URLs arrive pre-signed from the backend; CSP `img-src`
 * already allows `*.supabase.co`.
 */
export function Avatar({ name, photoUrl, size = 'md', className }: AvatarProps): ReactElement {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(photoUrl) && !imageFailed;

  const base =
    'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium';
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

  // Initials fallback. Decorative: the surrounding row already names the
  // member, so the glyphs carry no independent meaning.
  return (
    <span
      aria-hidden="true"
      className={`${base} ${dimensions} ${tintForName(name)}${className ? ` ${className}` : ''}`}
    >
      {initialsFor(name)}
    </span>
  );
}
