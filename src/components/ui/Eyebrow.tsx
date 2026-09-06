import type { ElementType, HTMLAttributes, ReactElement } from 'react';
import { Text } from './Text';

export type EyebrowColor =
  | 'ink-3'
  | 'ink-2'
  | 'clay'
  | 'moss'
  | 'dusk'
  | 'terracotta'
  | 'coral';

/**
 * `Text variant="eyebrow"` already paints ink-3, and a second `text-*` class in
 * the same attribute does NOT win — stylesheet order decides, and Tailwind
 * emits the palette in name order (`text-clay` @7146 lands BEFORE `text-ink-3`
 * @7346 in this project's compiled CSS). The `!` modifier is the deterministic
 * override; the codebase already uses it this way (`Avatar className="h-6!"`).
 * `ink-3` is the variant's own color, so it needs no override at all and stays
 * beatable by a caller's `className`.
 */
const TEXT: Record<EyebrowColor, string> = {
  'ink-3': '',
  'ink-2': 'text-ink-2!',
  clay: 'text-clay!',
  moss: 'text-moss!',
  dusk: 'text-dusk!',
  terracotta: 'text-terracotta!',
  coral: 'text-coral!',
};

/**
 * `deep` variant (spec §6.5: "eyebrow in the type deep color" — the hero's
 * stronger reading of a section tint). `ink-3`/`ink-2` have no `-deep` token
 * — ink is already the "deep" neutral — so those two fall back to `TEXT`
 * above rather than appearing here.
 */
const TEXT_DEEP: Partial<Record<EyebrowColor, string>> = {
  clay: 'text-clay-deep!',
  moss: 'text-moss-deep!',
  dusk: 'text-dusk-deep!',
  terracotta: 'text-terracotta-deep!',
  coral: 'text-coral-deep!',
};

/** The dot has no competing color class, so it takes the plain utility. */
const DOT: Record<EyebrowColor, string> = {
  'ink-3': 'bg-ink-3',
  'ink-2': 'bg-ink-2',
  clay: 'bg-clay',
  moss: 'bg-moss',
  dusk: 'bg-dusk',
  terracotta: 'bg-terracotta',
  coral: 'bg-coral',
};

const DOT_BASE = 'inline-block w-[5px] h-[5px] rounded-full mr-1.5 align-middle';

export interface EyebrowProps extends HTMLAttributes<HTMLElement> {
  color?: EyebrowColor;
  /** Mobile `Shell.sectionRow` + `dot`: a 5×5 disc before the label. */
  dot?: boolean;
  /** Renders the `-deep` shade of `color` (spec §6.5's hero eyebrow). */
  deep?: boolean;
  as?: ElementType;
}

/** The 12/400 uppercase tracked label above a title or beside a category. */
export function Eyebrow({
  color = 'ink-3',
  dot = false,
  deep = false,
  as,
  className,
  children,
  ...rest
}: EyebrowProps): ReactElement {
  const colorClass = deep ? (TEXT_DEEP[color] ?? TEXT[color]) : TEXT[color];
  const cls = [colorClass, className].filter(Boolean).join(' ');
  return (
    <Text variant="eyebrow" as={as ?? 'span'} className={cls || undefined} {...rest}>
      {dot ? <span aria-hidden="true" className={`${DOT_BASE} ${DOT[color]}`} /> : null}
      {children}
    </Text>
  );
}
