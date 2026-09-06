import type { ReactElement, ReactNode } from 'react';
import { Icon } from './Icon';
import { ICON_NAMES, type IconName } from './iconNames';
import { Text } from './Text';

export type EmptyStateTone = 'moss' | 'clay' | 'dusk' | 'terracotta' | 'coral' | 'neutral';

export interface EmptyStateProps {
  /**
   * Glyph for the tinted tile. Prefer an `IconName` (rendered at the `chrome`
   * tier in the tone's full color). A `ReactNode` is still accepted for the
   * rare call site building its own decorative element inline (no hand-drawn
   * icon module remains — those were deleted in Task 24).
   */
  icon: IconName | ReactNode;
  /** Short heading line. Renders as a real `<h2>` with the `h3` type variant. */
  title: string;
  /**
   * Heading level for `title`. Default `'h2'` (unchanged behavior) — pass
   * `'h1'` when this EmptyState is a terminal/whole-page state with no other
   * heading on the page (e.g. UpgradePage's "already Premium" / purchase-
   * success screens), so the page still has exactly one `<h1>`. The `h3` type
   * VARIANT (visual size/weight) is unchanged either way; only the tag moves.
   */
  titleAs?: 'h1' | 'h2';
  /** Optional supporting copy under the title. */
  description?: ReactNode;
  /** CTA slot (buttons, links). `children` is the older spelling of the same slot. */
  actions?: ReactNode;
  /** @deprecated Pass `actions` instead — same slot, clearer name. */
  children?: ReactNode;
  /** Section tint for the icon tile. Defaults to neutral paper. */
  tone?: EmptyStateTone;
  className?: string;
}

// 56×56 circle in the tone's soft color; the glyph is the tone at full
// strength (spec §4.5). Token classes only — no hardcoded hex. Static map so
// Tailwind's scanner sees every class.
const tileToneClass: Record<EmptyStateTone, string> = {
  moss: 'bg-moss-soft',
  clay: 'bg-clay-soft',
  dusk: 'bg-dusk-soft',
  terracotta: 'bg-terracotta-soft',
  coral: 'bg-coral-soft',
  neutral: 'bg-bg-2',
};

const iconToneClass: Record<EmptyStateTone, string> = {
  moss: 'text-moss',
  clay: 'text-clay',
  dusk: 'text-dusk',
  terracotta: 'text-terracotta',
  coral: 'text-coral',
  neutral: 'text-ink-2',
};

function isIconName(icon: IconName | ReactNode): icon is IconName {
  return typeof icon === 'string' && (ICON_NAMES as readonly string[]).includes(icon);
}

/**
 * Shared empty state (spec §4.5): 56 circular icon tile → `h3`-variant `<h2>`
 * → capped-width caption → action slot. Mirrors mobile's rich empty states.
 *
 * The title IS a heading: an empty state is the section's whole content when it
 * shows, and leaving it out of the outline strands screen-reader users with an
 * unlabelled region.
 */
export function EmptyState({
  icon,
  title,
  titleAs = 'h2',
  description,
  actions,
  children,
  tone = 'neutral',
  className,
}: EmptyStateProps): ReactElement {
  const actionSlot = actions ?? children;

  return (
    <div
      className={`flex flex-col items-center py-16 px-8 text-center${
        className ? ` ${className}` : ''
      }`}
    >
      <span
        aria-hidden="true"
        className={`w-14 h-14 rounded-full inline-flex items-center justify-center mb-5 ${tileToneClass[tone]}`}
      >
        {isIconName(icon) ? (
          <Icon name={icon} size="chrome" className={iconToneClass[tone]} />
        ) : (
          <span className={iconToneClass[tone]}>{icon}</span>
        )}
      </span>
      <Text variant="h3" as={titleAs} className="mb-2">
        {title}
      </Text>
      {description != null && (
        <Text variant="caption" className="max-w-[280px]">
          {description}
        </Text>
      )}
      {actionSlot != null && (
        <div className="mt-6 flex flex-col items-center gap-3">{actionSlot}</div>
      )}
    </div>
  );
}
