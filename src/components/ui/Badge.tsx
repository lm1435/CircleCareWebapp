import type { HTMLAttributes, ReactElement } from 'react';

// Section-tint variants mirror the mobile design system. Tinted backgrounds
// with deep text colors for WCAG AA contrast (mobile text-on-soft pattern).
export type BadgeVariant = 'neutral' | 'moss' | 'terracotta' | 'clay' | 'dusk';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const variantClass: Record<BadgeVariant, string> = {
  neutral: 'bg-bg-2 text-ink-2',
  moss: 'bg-moss/10 text-moss-deep',
  terracotta: 'bg-terracotta/10 text-terracotta-deep',
  clay: 'bg-clay/10 text-clay-deep',
  dusk: 'bg-dusk/10 text-dusk-deep',
};

/** Small pill badge (roles, statuses). Uppercase mono per design system. */
export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps): ReactElement {
  const base = `inline-flex items-center gap-1 rounded-full px-3 py-1 font-mono text-xs uppercase tracking-wider ${variantClass[variant]}`;
  return (
    <span className={className ? `${base} ${className}` : base} {...rest}>
      {children}
    </span>
  );
}
