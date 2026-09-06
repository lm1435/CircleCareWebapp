import { type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Eyebrow, type EyebrowColor } from './Eyebrow';
import { Icon } from './Icon';
import { Text } from './Text';

/** The section tint of the list the header points at (spec §4.5). */
export type SectionHeaderTone = 'dusk' | 'clay' | 'moss' | 'terracotta' | 'coral';

/**
 * Static map — Tailwind never sees an interpolated class name.
 *
 * `coral` resolves to `coral-deep`: the link is 14px text, and full-strength
 * coral is 4.11:1 on white (icons and 24px+ only, per the token comment in
 * globals.css). Every other tone clears AA at 14px on white.
 */
const TONE: Record<SectionHeaderTone, string> = {
  dusk: 'text-dusk',
  clay: 'text-clay',
  moss: 'text-moss',
  terracotta: 'text-terracotta',
  coral: 'text-coral-deep',
};

export interface SectionHeaderProps {
  title: string;
  /** Ties the heading to its section via aria-labelledby. */
  id?: string;
  /** Optional label above the title (mobile's clay eyebrow). */
  eyebrow?: ReactNode;
  eyebrowColor?: EyebrowColor;
  /** The title keeps the `sectionTitle` treatment at either level. */
  headingLevel?: 2 | 3;
  /** Convenience trailing "view all" link. */
  to?: string;
  linkLabel?: string;
  /** Section tint for the trailing link. Default `dusk` (activity, appointments). */
  tone?: SectionHeaderTone;
  /** Any other trailing content, when `to`/`linkLabel` do not fit. */
  action?: ReactNode;
  className?: string;
}

/**
 * The one section header (spec §4.5): padding 28 above / 12 below, title on the
 * `sectionTitle` variant, trailing action on a 44px hit area.
 *
 * Mirrors mobile's components/ui/SectionHeader. This was a local `CardHeader`
 * inside OverviewPage while TodaysMeds drew its own `<h2>` with a `px-1` offset,
 * so one card's heading sat 4px off from its neighbours'. Both now render this.
 *
 * The trailing link is no longer coral: it takes the section color of the list
 * it links to, as mobile does.
 */
export function SectionHeader({
  title,
  id,
  eyebrow,
  eyebrowColor,
  headingLevel = 2,
  to,
  linkLabel,
  tone = 'dusk',
  action,
  className,
}: SectionHeaderProps): ReactElement {
  const trailing =
    action ??
    (to && linkLabel ? (
      <Link
        to={to}
        className={`inline-flex min-h-[44px] items-center gap-1 text-sm font-medium ${TONE[tone]}`}
      >
        {linkLabel}
        <Icon name="chevron-forward" size="inline" />
      </Link>
    ) : null);

  return (
    <div
      className={['flex flex-wrap items-end justify-between gap-x-3 gap-y-2 pt-7 pb-3', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow ? <Eyebrow color={eyebrowColor ?? 'clay'}>{eyebrow}</Eyebrow> : null}
        <Text variant="sectionTitle" as={headingLevel === 3 ? 'h3' : 'h2'} id={id}>
          {title}
        </Text>
      </div>
      {trailing ? <div className="flex min-h-[44px] shrink-0 items-center">{trailing}</div> : null}
    </div>
  );
}
