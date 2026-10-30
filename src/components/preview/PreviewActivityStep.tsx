import { useMemo, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActivityFeedItem, ActivityActor } from '@/api/activityFeed';
import { ActivityItem } from '@/components/activity/ActivityItem';
import { Text } from '@/components/ui';
import { getDateInTimezone, getDeviceTimezone } from '@/utils/timezone';
import { PreviewAnnotation } from './PreviewAnnotation';

/**
 * "See how it works", step 2 — the activity feed those doses produce (mobile
 * `PreviewActivityPage`). Renders the REAL `ActivityItem` over fabricated rows,
 * so the sample can never drift from the feed. `ActivityItem` fetches nothing
 * signed out (its hour-cycle query is gated on a session), and none of these
 * rows carries a `note_target`, so none renders as a link.
 *
 * The masthead is the feed's own (`activity:title` / `activity:subtitle`), not a
 * preview copy of it — same choice as mobile.
 */

const HOUR_MS = 60 * 60 * 1000;

function demoActor(id: string, firstName: string): ActivityActor {
  return { id, email: `${id}@example.invalid`, first_name: firstName, last_name: null };
}

export interface PreviewActivityStepProps {
  /** id of the step's <h1>; the page focuses it when the step changes. */
  headingId: string;
}

export function PreviewActivityStep({ headingId }: PreviewActivityStepProps): ReactElement {
  const { t } = useTranslation(['auth', 'activity']);
  const timezone = getDeviceTimezone();

  const { today, yesterday } = useMemo(() => {
    const now = Date.now();
    const at = (hoursAgo: number): string => new Date(now - hoursAgo * HOUR_MS).toISOString();
    const sarah = demoActor('demo-sarah', t('auth:preview.demo.members.sarah'));
    const dad = demoActor('demo-dad', t('auth:preview.demo.members.dad'));
    const you = demoActor('demo-you', t('auth:preview.demo.members.you'));

    // Legacy description rows: the English leading phrase is localized by the
    // renderer; the tail is fabricated demo content, so it is ours to translate
    // (see the matching note in mobile's PreviewActivityPage).
    const todayRows: ActivityFeedItem[] = [
      {
        id: 'demo-activity-1',
        circle_id: 'demo-circle',
        action_type: 'medication_confirmed',
        description: `Confirmed Medication: ${t('auth:preview.demo.activities.medication')}`,
        metadata: { scheduled_date: getDateInTimezone(timezone, new Date(now - 2 * HOUR_MS)) },
        created_at: at(2),
        actor: sarah,
      },
      {
        id: 'demo-activity-2',
        circle_id: 'demo-circle',
        action_type: 'appointment_created',
        description: `Added Appointment: ${t('auth:preview.demo.activities.appointment')}`,
        created_at: at(5),
        actor: dad,
      },
    ];
    const yesterdayRows: ActivityFeedItem[] = [
      {
        id: 'demo-activity-3',
        circle_id: 'demo-circle',
        action_type: 'task_completed',
        description: `Completed Task: ${t('auth:preview.demo.activities.task')}`,
        created_at: at(27),
        actor: sarah,
      },
      {
        id: 'demo-activity-4',
        circle_id: 'demo-circle',
        action_type: 'member_joined',
        // The parameterized path, so the sample shows one of each.
        description_key: 'entries.memberJoined.caregiver',
        description_params: { name: t('auth:preview.demo.members.you') },
        description: 'You joined the circle as Caregiver',
        created_at: at(30),
        actor: you,
      },
    ];
    return { today: todayRows, yesterday: yesterdayRows };
  }, [t, timezone]);

  const dayLabel = (label: string): ReactElement => (
    <div className="flex items-center gap-3 pt-3 pb-1">
      <Text variant="eyebrow" as="h2">
        {label}
      </Text>
      <span aria-hidden="true" className="h-px flex-1 bg-line-2" />
    </div>
  );

  return (
    <div>
      <Text variant="authTitle" id={headingId} tabIndex={-1} className="outline-none">
        {t('activity:title')}
      </Text>
      <Text variant="bodyMedium" className="mt-2.5 text-ink-2!">
        {t('activity:subtitle')}
      </Text>

      <PreviewAnnotation text={t('auth:preview.annotations.activityOverview')} className="mt-5" />

      {dayLabel(t('activity:today'))}
      <ul className="m-0 -mx-5 list-none p-0">
        {today.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} timezone={timezone} />
        ))}
      </ul>

      <PreviewAnnotation text={t('auth:preview.annotations.familySync')} className="mt-3" />

      {dayLabel(t('activity:yesterday'))}
      <ul className="m-0 -mx-5 list-none p-0">
        {yesterday.map((activity) => (
          <ActivityItem key={activity.id} activity={activity} timezone={timezone} />
        ))}
      </ul>
    </div>
  );
}
