import type { HTMLAttributes, ReactElement } from 'react';
import { Icon, type IconSize } from './Icon';
import type { IconName } from './iconNames';

export type IconTileTone = 'moss' | 'clay' | 'dusk' | 'terracotta' | 'coral' | 'neutral';
/** 36 is the row/settings tile; 32 the activity tile (spec §4.5). */
export type IconTileSize = 32 | 36 | 40 | 44;

/**
 * Written out literally, one class per tone: Tailwind scans source text, so an
 * interpolated `bg-${tone}/15` compiles to nothing at all.
 */
const TONE: Record<IconTileTone, string> = {
  moss: 'bg-moss/15 text-moss',
  clay: 'bg-clay/15 text-clay',
  dusk: 'bg-dusk/15 text-dusk',
  terracotta: 'bg-terracotta/15 text-terracotta',
  coral: 'bg-coral/15 text-coral',
  neutral: 'bg-bg-2 text-ink-2',
};

const TONE_FILLED: Record<IconTileTone, string> = {
  moss: 'bg-moss text-cream',
  clay: 'bg-clay text-cream',
  dusk: 'bg-dusk text-cream',
  terracotta: 'bg-terracotta text-cream',
  coral: 'bg-coral text-cream',
  // No `neutral` tint token exists; ink-2 is the neutral ink the unfilled tile
  // already uses, so the filled tile inverts around it.
  neutral: 'bg-ink-2 text-cream',
};

const BOX: Record<IconTileSize, string> = {
  32: 'w-8 h-8',
  36: 'w-9 h-9',
  40: 'w-10 h-10',
  44: 'w-11 h-11',
};

const ICON: Record<IconTileSize, IconSize> = {
  32: 'inline',
  36: 'row',
  40: 'row',
  44: 'chrome',
};

const BASE = 'inline-flex items-center justify-center shrink-0 rounded-[10px]';

export interface IconTileProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  tone: IconTileTone;
  name: IconName;
  size?: IconTileSize;
  /** Inverts the tile: full-strength tone behind a cream glyph. */
  filled?: boolean;
  /** Announce the tile when it carries meaning no adjacent text repeats. */
  label?: string;
}

/**
 * The tinted square behind a glyph (mobile `UpcomingAppointments.icon`,
 * `settingsIconWrap`, `ActivityFeedScreen.iconTile`). Decorative by default —
 * these tiles always sit beside the text they illustrate.
 */
export function IconTile({
  tone,
  name,
  size = 36,
  filled = false,
  label,
  className,
  ...rest
}: IconTileProps): ReactElement {
  const cls = [BASE, BOX[size], filled ? TONE_FILLED[tone] : TONE[tone], className]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={cls} {...rest}>
      <Icon name={name} size={ICON[size]} label={label} />
    </span>
  );
}
