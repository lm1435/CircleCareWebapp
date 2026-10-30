import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Eyebrow, Text } from '@/components/ui';
import { getDateInTimezone } from '@/utils/timezone';

// The Today header (docs/plans/simple-ui-1-3-1.md; hi-fi HiToday): a
// "● WEDNESDAY, OCTOBER 28" eyebrow over "Today for {{name}}". It replaces the
// old avatar / DOB / "Cared for by" hero: Today is for doing, and the circle's
// people live on Members.

/** The recipient's today, long form in the viewer's language ("Wednesday, October 28"). */
export function formatTodayEyebrow(
  timezone: string | null,
  locale: string,
  now: Date = new Date()
): string | null {
  if (!timezone) return null;
  const day = getDateInTimezone(timezone, now);
  // Anchor at noon UTC and format in UTC so no zone can roll it onto a neighbouring day.
  const anchor = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(anchor.getTime())) return null;
  try {
    return anchor.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return day;
  }
}

export interface HeroProps {
  recipientName: string;
  /** Self-care circle: the title is just "Today". */
  isSelfCare?: boolean;
  /** The care recipient's IANA zone; the date eyebrow waits for it. */
  recipientTimezone: string | null;
}

export function Hero({ recipientName, isSelfCare = false, recipientTimezone }: HeroProps): ReactElement {
  const { t, i18n } = useTranslation('overview');
  const eyebrow = formatTodayEyebrow(recipientTimezone, i18n.language);
  const title = isSelfCare || !recipientName ? t('today.titleSelf') : t('today.title', { name: recipientName });

  return (
    <header className="px-5 pt-5 pb-4" data-testid="overview-hero">
      {eyebrow ? (
        <Eyebrow dot deep color="moss" className="mb-1">
          {eyebrow}
        </Eyebrow>
      ) : null}
      {/* NEVER truncated: a long name wraps onto a second line. */}
      <Text variant="heroName" className="break-words">
        {title}
      </Text>
    </header>
  );
}

export default Hero;
