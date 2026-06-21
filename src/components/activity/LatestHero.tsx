import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem } from '@/api/activityFeed';
import { Avatar } from '@/components/ui/Avatar';
import { getActivityAccent, getActivityIconPaths } from './ActivityIcon';
import { translateActivityDescription } from './activityTranslation';
import { formatRelativeTime, getActorName } from './activityFormat';

// "Latest / LIVE" hero (mirrors mobile's LatestPill in
// mobile/src/screens/activity/ActivityFeedScreen.tsx). Spotlights the single
// most recent activity at the top of the feed. Rendered ONLY when there is at
// least one activity — never on empty / loading / error.
//
// The hero LEADS WITH WHAT HAPPENED — the same localized description the feed
// rows render (translateActivityDescription) — attributed to the actor with a
// quiet relative timestamp, rather than just "{time} · {name}". Its accent
// (rail + icon medallion + LIVE dot) picks up the event-type color so the
// freshest event reads as alive and informative at a glance.

export interface LatestHeroProps {
  activity: ActivityFeedItem;
}

export function LatestHero({ activity }: LatestHeroProps): ReactElement {
  const { t, i18n } = useTranslation('activity');
  const locale = i18n.language;

  const actorName = getActorName(activity.actor, t);
  const timeText = formatRelativeTime(activity.created_at, t, locale);
  const description = translateActivityDescription(activity.description, t);
  const accent = getActivityAccent(activity.action_type);

  return (
    // The hero summarizes the newest entry, which also appears in the list
    // below. To avoid screen readers announcing the same content twice, the
    // spotlight body is aria-hidden; the region keeps an accessible name from
    // the visible "Latest" eyebrow so SR users still know a featured item
    // exists, then encounter the full entry in the list.
    <section
      aria-label={t('latest')}
      className="relative mb-6 overflow-hidden rounded-2xl border border-line bg-cream shadow-[0_1px_2px_rgba(26,25,22,0.04),0_8px_24px_-12px_rgba(26,25,22,0.12)]"
    >
      {/* Event-type accent rail down the leading edge. */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${accent.rail}`} />

      <div aria-hidden="true" className="flex items-start gap-4 p-5 pl-6">
        {/* Solid event-type medallion — the focal glyph at hero scale. */}
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-cream ${accent.solid}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            {getActivityIconPaths(activity.action_type)}
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`text-[0.6875rem] font-semibold uppercase tracking-[0.18em] ${accent.text}`}
            >
              {t('latest')}
            </span>

            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-2.5 py-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-cream">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-cream opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cream" />
              </span>
              {t('live')}
            </span>
          </div>

          {/* WHAT happened — the headline of the hero. */}
          <p className="m-0 mt-1.5 text-base font-medium leading-snug text-ink">{description}</p>

          {/* Quiet attribution: who + when. */}
          <p className="m-0 mt-2.5 flex items-center gap-2 text-sm text-ink-3">
            <Avatar name={actorName} size="xs" className="h-6 w-6 text-[0.625rem]" />
            <span className="truncate font-medium text-ink-2">{actorName}</span>
            <span aria-hidden="true">&middot;</span>
            <time dateTime={activity.created_at}>{timeText}</time>
          </p>
        </div>
      </div>
    </section>
  );
}
