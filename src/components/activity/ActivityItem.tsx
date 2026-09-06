import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem } from '@/api/activityFeed';
import { Avatar, Icon, Sheet } from '@/components/ui';
import { getActivityIcon, getActivityIconName, getActivityTileClass } from './ActivityIcon';
import { renderActivityDescription } from './activityTranslation';
import { formatDateShort, formatRelativeTime, getActorName, getLocalDateKey } from './activityFormat';
import { useHourCycle } from '@/hooks/useHourCycle';

// Single activity entry (Task 17, web mobile-parity wave; mirrors mobile's
// ActivityRow in mobile/src/components/activity/ActivityRow.tsx plus the
// screen's timeline rail, per spec §6.5). Read-only — there is nothing to tap
// on web (mobile's tap-to-calendar navigation is intentionally not ported).

export interface ActivityItemProps {
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

export function ActivityItem({ activity, timezone }: ActivityItemProps): ReactElement {
  const { t } = useTranslation('activity');
  // The viewer's 12h/24h clock. Reuses the shared currentUser query — no extra
  // request. Needed because a parameterized row carries a RAW 'HH:MM:SS' and
  // this client, not the server, decides how to render it.
  const hourCycle = useHourCycle();

  const actorName = getActorName(activity.actor, t);
  const timeText = formatRelativeTime(activity.created_at, t);
  const iconName = getActivityIconName(activity.action_type);

  // "Scheduled for {date}" note when a med was confirmed on a different
  // viewer-local day than its scheduled date (mirrors mobile's late note).
  const isMedicationActivity = activity.action_type === 'medication_confirmed';
  const scheduledDate = activity.metadata?.scheduled_date;
  const lateScheduledDate =
    isMedicationActivity && scheduledDate && scheduledDate !== getLocalDateKey(activity.created_at)
      ? scheduledDate
      : null;

  return (
    <li className="relative px-5">
      {/* Vertical timeline rail — a hairline per item, at the icon tiles'
          shared center (44-wide left col: 20px item padding + 22px half of
          44), so a flat `<ul>` of `<li>` rows still reads as one continuous
          thread (mobile `timelineRail` / `itemWrapper`). */}
      <span aria-hidden="true" className="absolute left-[42px] top-0 bottom-0 w-px bg-line-2" />

      <div className="flex items-start gap-4 py-2.5">
        <div className="relative z-[1] flex w-11 shrink-0 justify-center">
          <span
            aria-hidden="true"
            data-activity-icon={iconName}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-sm border-2 ${getActivityTileClass(activity.action_type)}`}
          >
            <Icon name={getActivityIcon(activity.action_type)} size="meta" />
          </span>
        </div>

        {/* A Sheet, not a Card: mobile's row is a bordered `Sheet` with the
            light lift, and the shadow-only card lost its edge against the page. */}
        <Sheet className="flex-1 min-w-0 px-[18px] py-3.5">
          <p className="m-0 text-sm leading-5 text-ink">
            {renderActivityDescription(activity, t, { hourCycle, timezone })}
          </p>
          {lateScheduledDate && (
            <p className="m-0 mt-1 text-xs italic text-ink-3">
              {t('scheduledFor', { date: formatDateShort(lateScheduledDate, t) })}
            </p>
          )}
          <p className="m-0 mt-2 flex items-center gap-1.5 text-xs text-ink-3">
            {/* Actor avatar dot — mirrors mobile's footer initials circle
                (mobile/src/components/activity/ActivityRow.tsx avatarCircle).
                Initials only (the payload carries no actor photo); decorative,
                the actor name beside it carries the meaning. */}
            <Avatar name={actorName} size="xs" className="h-[18px]! w-[18px]!" />
            <span className="font-medium text-ink-2">{actorName}</span>
            <span aria-hidden="true">&middot;</span>
            <time dateTime={activity.created_at} className="tracking-[0.3px]">
              {timeText}
            </time>
          </p>
        </Sheet>
      </div>
    </li>
  );
}
