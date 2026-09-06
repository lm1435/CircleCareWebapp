import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem } from '@/api/activityFeed';
import { Avatar, Badge, Eyebrow, IconTile, Sheet } from '@/components/ui';
import {
  getActivityEyebrowColor,
  getActivityIcon,
  getActivityRailClass,
  getActivityTone,
} from './ActivityIcon';
import { renderActivityDescription } from './activityTranslation';
import { formatRelativeTime, getActorName } from './activityFormat';
import { useHourCycle } from '@/hooks/useHourCycle';

// "Latest / New" hero (Task 17, web mobile-parity wave; mirrors mobile's
// LatestPill in mobile/src/screens/activity/ActivityFeedScreen.tsx, adapted to
// this project's Card/IconTile/Badge primitives per spec §6.5). Spotlights the
// single most recent activity at the top of the feed. Rendered ONLY when
// there is at least one activity — never on empty / loading / error.
//
// The hero LEADS WITH WHAT HAPPENED — the same localized description the feed
// rows render (renderActivityDescription) — attributed to the actor with a
// quiet relative timestamp, rather than just "{time} · {name}". Its accent
// (rail + icon tile + eyebrow) picks up the event-type color so the freshest
// event reads as informative at a glance. The badge says "New", not mobile's
// "Live" — this feed is fetched, not realtime, so it must not promise live
// updates (spec §6.5 renames the web key `live` -> `new` for exactly this).

export interface LatestHeroProps {
  activity: ActivityFeedItem;
  /**
   * The care recipient's IANA timezone — the frame a parameterized row's
   * `scheduledTime` is expressed in, and what its rendered time is labelled
   * with. Required, not defaulted: a wrong label is worse than none, so the
   * caller must say which circle this row belongs to.
   *
   * `null` while the circle query is in flight — the renderer then falls back
   * to the server-written description rather than labelling a time with the
   * loading fallback zone.
   */
  timezone: string | null;
}

export function LatestHero({ activity, timezone }: LatestHeroProps): ReactElement {
  const { t } = useTranslation('activity');
  const hourCycle = useHourCycle();

  const actorName = getActorName(activity.actor, t);
  const timeText = formatRelativeTime(activity.created_at, t);
  // Same renderer as the feed rows below, so the hero and the row it duplicates
  // can never disagree about the same activity.
  const description = renderActivityDescription(activity, t, { hourCycle, timezone });
  const tone = getActivityTone(activity.action_type);
  const icon = getActivityIcon(activity.action_type);
  const railClass = getActivityRailClass(activity.action_type);
  const eyebrowColor = getActivityEyebrowColor(activity.action_type);

  return (
    // The hero summarizes the newest entry, which also appears in the list
    // below. To avoid screen readers announcing the same content twice, the
    // spotlight body is aria-hidden; the region keeps an accessible name from
    // the visible "Latest" eyebrow so SR users still know a featured item
    // exists, then encounter the full entry in the list.
    <Sheet
      role="region"
      aria-label={t('latest')}
      padding="sm"
      className="relative mb-6 overflow-hidden"
    >
      {/* Event-type accent rail down the leading edge. */}
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${railClass}`} />

      <div aria-hidden="true" className="flex items-start gap-4">
        <IconTile tone={tone} name={icon} size={44} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <Eyebrow color={eyebrowColor} deep>
              {t('latest')}
            </Eyebrow>
            <Badge variant="coral" size="sm">
              {t('new')}
            </Badge>
          </div>

          {/* WHAT happened — the headline of the hero. */}
          <p className="m-0 mt-1.5 text-md leading-snug text-ink">{description}</p>

          {/* Quiet attribution: who + when (same footer shape as a feed row). */}
          <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-ink-3">
            <Avatar name={actorName} size="xs" className="h-[18px]! w-[18px]!" />
            <span className="font-medium text-ink-2">{actorName}</span>
            <span aria-hidden="true">&middot;</span>
            <time dateTime={activity.created_at} className="tracking-[0.3px]">
              {timeText}
            </time>
          </p>
        </div>
      </div>
    </Sheet>
  );
}
