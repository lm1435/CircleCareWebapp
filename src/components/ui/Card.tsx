import type { HTMLAttributes, ReactElement } from 'react';

export type CardVariant = 'elevated' | 'outlined' | 'flat';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Surface treatment. Default `'outlined'` reproduces TODAY's look exactly
   * (`rounded-2xl border border-line bg-cream p-6`) so no consumer shifts.
   * `elevated` opts into a raised card matching mobile (soft ink-token shadow
   * + slightly tighter ~20px radius). `flat` drops the border for nested use.
   */
  variant?: CardVariant;
}

// Built from the ink token (--ink = #1a1916 → rgb 26 25 22), reusing the exact
// rgba values already present in globals.css (0.08 / 0.15 alpha). Layered soft
// shadow mirrors mobile's raised cards without introducing new tokens.
const ELEVATED_SHADOW =
  'shadow-[0_1px_2px_rgba(26,25,22,0.08),0_8px_24px_-6px_rgba(26,25,22,0.15)]';

const variantClass: Record<CardVariant, string> = {
  // Default — byte-identical to the prior component output.
  outlined: 'rounded-2xl border border-line bg-cream p-6',
  // Raised: tighter 20px radius + soft ink shadow, opt-in.
  elevated: `rounded-[20px] border border-line-2 bg-cream p-6 ${ELEVATED_SHADOW}`,
  // Borderless surface for nesting inside other cards.
  flat: 'rounded-2xl bg-cream p-6',
};

/** Cream surface card on the paper background, per design system. */
export function Card({
  variant = 'outlined',
  className,
  children,
  ...rest
}: CardProps): ReactElement {
  const base = variantClass[variant];
  return (
    <div className={className ? `${base} ${className}` : base} {...rest}>
      {children}
    </div>
  );
}
