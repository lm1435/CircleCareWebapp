import type { ReactElement, ReactNode } from 'react';

export type EmptyStateTone = 'moss' | 'terracotta' | 'clay' | 'dusk' | 'neutral';

export interface EmptyStateProps {
  /** Leading glyph rendered inside the tinted icon tile (decorative). */
  icon: ReactNode;
  /** Short, bold heading line. Rendered as text — not a semantic heading. */
  title: string;
  /** Optional supporting copy under the title. */
  description?: ReactNode;
  /** Optional CTA / action slot (buttons, links). */
  children?: ReactNode;
  /** Section tint for the icon tile. Defaults to neutral paper. */
  tone?: EmptyStateTone;
  className?: string;
}

// Soft-tinted icon tile per section token (mirrors mobile's icon-tile empty
// states). Token classes only — no hardcoded hex.
const tileToneClass: Record<EmptyStateTone, string> = {
  moss: 'bg-moss-soft text-moss-deep',
  terracotta: 'bg-terracotta-soft text-terracotta-deep',
  clay: 'bg-clay-soft text-clay-deep',
  dusk: 'bg-dusk-soft text-dusk-deep',
  neutral: 'bg-bg-2 text-ink-2',
};

/**
 * Shared empty state: tinted icon tile + heading + optional description + an
 * optional action slot. Mirrors mobile's rich empty states (icon tile → copy →
 * CTA) instead of the prior thin text-only cards.
 *
 * The title renders as styled text rather than a heading element so callers can
 * place it inside arbitrary contexts (including pages whose tests assert no
 * extra headings).
 */
export function EmptyState({
  icon,
  title,
  description,
  children,
  tone = 'neutral',
  className,
}: EmptyStateProps): ReactElement {
  return (
    <div className={`flex flex-col items-center text-center${className ? ` ${className}` : ''}`}>
      <span
        aria-hidden="true"
        className={`inline-flex h-14 w-14 items-center justify-center rounded-2xl ${tileToneClass[tone]}`}
      >
        {icon}
      </span>
      <p className="m-0 mt-4 font-medium text-ink">{title}</p>
      {description != null && <p className="m-0 mt-1 text-sm text-ink-3">{description}</p>}
      {children != null && <div className="mt-6">{children}</div>}
    </div>
  );
}
