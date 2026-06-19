import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem } from '@/api/activityFeed';
import { Avatar } from '@/components/ui/Avatar';
import { ActivityIcon } from './ActivityIcon';
import { translateActivityDescription } from './activityTranslation';
import { formatDateShort, formatRelativeTime, getActorName, getLocalDateKey } from './activityFormat';

// Single activity entry (Task 26): type icon, localized action text, member
// name, relative timestamp. Read-only — there is nothing to tap on web
// (mobile's tap-to-calendar navigation is intentionally not ported).

export interface ActivityItemProps {
  activity: ActivityFeedItem;
}

export function ActivityItem({ activity }: ActivityItemProps): ReactElement {
  const { t, i18n } = useTranslation('activity');
  const locale = i18n.language;

  const actorName = getActorName(activity.actor, t);
  const timeText = formatRelativeTime(activity.created_at, t, locale);

  // "Scheduled for {date}" note when a med was confirmed on a different
  // viewer-local day than its scheduled date (mirrors mobile's late note).
  const isMedicationActivity = activity.action_type === 'medication_confirmed';
  const scheduledDate = activity.metadata?.scheduled_date;
  const lateScheduledDate =
    isMedicationActivity && scheduledDate && scheduledDate !== getLocalDateKey(activity.created_at)
      ? scheduledDate
      : null;

  return (
    <li className="flex items-start gap-3 border-b border-line-2 py-4 last:border-b-0">
      <ActivityIcon actionType={activity.action_type} />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-sm leading-snug text-ink">
          {translateActivityDescription(activity.description, t)}
        </p>
        {lateScheduledDate && (
          <p className="m-0 mt-0.5 text-xs italic text-ink-3">
            {t('scheduledFor', { date: formatDateShort(lateScheduledDate, t, locale) })}
          </p>
        )}
        <p className="m-0 mt-1 flex items-center gap-1.5 text-xs text-ink-3">
          {/* Actor avatar dot — mirrors mobile's footer initials circle
              (mobile/src/screens/activity/ActivityFeedScreen.tsx avatarCircle).
              Initials only (the payload carries no actor photo); decorative,
              the actor name beside it carries the meaning. */}
          <Avatar name={actorName} size="xs" className="h-5 w-5 text-[0.625rem]" />
          <span className="font-medium text-ink-2">{actorName}</span>
          <span aria-hidden="true">&middot;</span>
          <time dateTime={activity.created_at}>{timeText}</time>
        </p>
      </div>
    </li>
  );
}
