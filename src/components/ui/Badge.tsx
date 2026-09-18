import type { HTMLAttributes, ReactElement } from 'react';
import { Icon } from './Icon';
import type { IconName } from './iconNames';

/**
 * Mobile-parity semantic variants (spec §4.5). Tinted grounds with deep text
 * colors — the mobile text-on-soft contrast pattern.
 */
export type BadgeVariantName =
  | 'default'
  | 'primary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'error'
  | 'coral'
  | 'dusk';

export type BadgeVariant = BadgeVariantName;

export type BadgeSize = 'sm' | 'md';

export interface BadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'style'> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Optional leading glyph, rendered at the `meta` (14px) icon tier. */
  icon?: IconName;
  /**
   * Let long copy wrap (centred, never wider than its container) instead of
   * the default single line. For sentence-length pills such as the Upgrade
   * page's trial hook, whose ES copy is 415px on one line — wider than a 390px
   * phone, so the whole page scrolled sideways.
   */
  wrap?: boolean;
}

// Token classes only — no hardcoded hex.
const variantClass: Record<BadgeVariant, string> = {
  default: 'bg-line-2 text-ink-2',
  primary: 'bg-moss-soft text-moss-deep',
  accent: 'bg-clay-line text-clay-deep',
  success: 'bg-moss-soft text-moss-deep',
  warning: 'bg-amber-soft text-amber-deep',
  error: 'bg-terracotta-soft text-terracotta-deep',
  coral: 'bg-coral-soft text-coral-deep',
  dusk: 'bg-dusk-soft text-dusk-deep',
};

const sizeClass: Record<BadgeSize, string> = {
  sm: 'text-xs px-2 py-0.5',
  md: 'text-xs px-3 py-1',
};

/**
 * Small pill badge (roles, statuses). Sentence case per design system.
 *
 * `style` is intentionally excluded from the accepted props (spec §4.5 bans
 * inline tints) — every caller renders through a named `variant` instead.
 */
export function Badge({
  variant = 'default',
  size = 'md',
  icon,
  wrap = false,
  className,
  children,
  ...rest
}: BadgeProps): ReactElement {
  const flow = wrap
    ? 'whitespace-normal max-w-full justify-center text-center text-balance'
    : 'whitespace-nowrap';
  const base = `rounded-full font-semibold inline-flex items-center gap-1 ${flow} ${sizeClass[size]} ${variantClass[variant]}`;
  return (
    <span className={className ? `${base} ${className}` : base} {...rest}>
      {icon != null && <Icon name={icon} size="meta" />}
      {children}
    </span>
  );
}
