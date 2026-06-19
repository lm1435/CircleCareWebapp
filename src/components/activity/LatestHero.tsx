import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem } from '@/api/activityFeed';
import { Avatar } from '@/components/ui/Avatar';
import { formatRelativeTime, getActorName } from './activityFormat';

// "Latest / LIVE" hero (mirrors mobile's LatestPill in
// mobile/src/screens/activity/ActivityFeedScreen.tsx). Spotlights the single
// most recent activity at the top of the feed. Rendered ONLY when there is at
// least one activity — never on empty / loading / error.

export interface LatestHeroProps {
  activity: ActivityFeedItem;
}

export function LatestHero({ activity }: LatestHeroProps): ReactElement {
  const { t, i18n } = useTranslation('activity');
  const locale = i18n.language;

  const actorName = getActorName(activity.actor, t);
  const timeText = formatRelativeTime(activity.created_at, t, locale);

  return (
    // The hero summarizes the newest entry, which also appears in the list
    // below. To avoid screen readers announcing the same content twice, the
    // spotlight body is aria-hidden; the region keeps an accessible name from
    // the visible "Latest" eyebrow so SR users still know a featured item
    // exists, then encounter the full entry in the list.
    <section
      aria-label={t('latest')}
      className="mb-6 flex items-center gap-3 rounded-xl border border-dusk/15 bg-dusk-soft/60 p-4"
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-dusk/15 text-dusk-deep"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          focusable="false"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>

      <div aria-hidden="true" className="min-w-0 flex-1">
        <span className="serif text-[0.6875rem] font-medium uppercase tracking-[0.15em] text-ink-3">
          {t('latest')}
        </span>
        <p className="m-0 mt-0.5 flex items-center gap-1.5 text-sm text-ink">
          <Avatar name={actorName} size="xs" className="h-5 w-5 text-[0.625rem]" />
          <span className="truncate">{t('latestEntry', { time: timeText, name: actorName })}</span>
        </p>
      </div>

      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-dusk/15 px-2.5 py-1 text-[0.6875rem] font-medium uppercase tracking-wide text-dusk-deep">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 rounded-full bg-dusk-deep motion-safe:animate-pulse"
        />
        {t('live')}
      </span>
    </section>
  );
}
