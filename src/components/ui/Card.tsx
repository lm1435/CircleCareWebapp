import { createElement, type ElementType, type HTMLAttributes, type ReactElement } from 'react';

export type CardVariant = 'elevated' | 'outlined' | 'filled' | 'accent' | 'flat';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

/** Spec §4.5. Card radius is 20 (`rounded-xl`) everywhere mobile's card is 20. */
const VARIANT: Record<CardVariant, string> = {
  elevated: 'bg-cream shadow-md',
  outlined: 'bg-cream border border-line-2',
  filled: 'bg-bg-2',
  accent: 'bg-clay-soft border border-clay-sand shadow-warm',
  flat: 'bg-bg',
};

/** Default 20 (`spacing[5]`), per spec §4.5. */
const PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
};

const PRESSABLE =
  'text-left w-full transition-transform duration-fast ease-spring active:scale-[0.98] hover:opacity-95 cursor-pointer';

/**
 * A caller-supplied `p-*` in `className` REPLACES the padding class rather than
 * racing it. Class order in the attribute decides nothing — stylesheet order
 * does — and Tailwind emits `p-4` BEFORE `p-5`, so `<Card className="p-4">`
 * would silently keep 20px. (Measured against this project's compiled CSS:
 * p-4 @6873 · p-5 @6925 · p-6 @6977.) Directional padding (`px-*`, `pt-*`) is
 * additive on purpose and does not suppress the default.
 */
const OVERRIDES_PADDING = /\bp-\d/;
// Same trap as padding: Tailwind emits `.rounded-2xl` BEFORE `.rounded-xl`, so a
// caller's `rounded-2xl` would silently lose to the variant's radius if both
// were present. Skip ours when the caller supplies any radius utility.
const OVERRIDES_RADIUS = /\brounded-(?!full\b)/;
const RADIUS: Record<CardVariant, string> = {
  elevated: 'rounded-xl',
  outlined: 'rounded-xl',
  filled: 'rounded-xl',
  accent: 'rounded-xl',
  flat: 'rounded-lg',
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  padding?: CardPadding;
  /** Makes the whole surface a control: renders a `<button type="button">`. */
  onPress?: () => void;
  /**
   * Semantic wrapper (`li`, `section`, `article`). When combined with
   * `onPress` the press affordances land on THIS element, so only pass an
   * interactive tag — otherwise the click has no keyboard equivalent.
   */
  as?: ElementType;
}

/** The one card surface (spec §4.5). */
export function Card({
  variant = 'elevated',
  padding = 'md',
  onPress,
  as,
  className,
  children,
  ...rest
}: CardProps): ReactElement {
  const pad = className && OVERRIDES_PADDING.test(className) ? '' : PADDING[padding];
  const radius = className && OVERRIDES_RADIUS.test(className) ? '' : RADIUS[variant];
  const tag: ElementType = as ?? (onPress ? 'button' : 'div');
  const cls = [VARIANT[variant], radius, pad, onPress ? PRESSABLE : '', className].filter(Boolean).join(' ');

  return createElement(
    tag,
    {
      className: cls,
      ...(onPress ? { onClick: onPress } : null),
      ...(tag === 'button' ? { type: 'button' } : null),
      ...rest,
    },
    children
  );
}
