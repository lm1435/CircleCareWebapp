import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getCurrentUser } from '@/api/users';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';
import { viewerInstant } from '@/utils/recipientEventDate';
import { doseFallsInOwnQuietHours, type ReminderRecipientMember } from '@/utils/quietHours';

/**
 * Inline amber note under a medication dose time: "This time is during quiet
 * hours, so no reminder will be sent then." Mirrors mobile's
 * `DoseQuietHoursNote` exactly (same rule, same copy).
 *
 * The at-due dose reminder is DROPPED (not queued) inside the recipient's quiet
 * hours, and new accounts have quiet hours OFF, so this only speaks up for
 * someone who turned them on. It NEVER blocks Save — display only.
 *
 * LIMITATION (deliberate, same on mobile): quiet hours are self-read only, so
 * the form can only check the VIEWER's own. It warns when the viewer is the one
 * who receives the reminder (medication-responsible member, else care-recipient
 * member, else circle owner) and stays silent when it goes to someone else.
 *
 * The parent passes `applies = false` when no at-due reminder will exist
 * (not a medication, as-needed, reminders off, "At the scheduled time" off).
 */
export interface DoseQuietHoursNoteProps {
  applies: boolean;
  /** Viewer-frame `YYYY-MM-DD` and `HH:MM`, exactly as the form holds them. */
  dateStr: string;
  timeStr: string;
  members: readonly ReminderRecipientMember[] | null | undefined;
  ownerId: string | null | undefined;
}

export function DoseQuietHoursNote({
  applies,
  dateStr,
  timeStr,
  members,
  ownerId,
}: DoseQuietHoursNoteProps) {
  const { t } = useTranslation('calendar');
  const viewerId = useAuthStore((s) => s.user?.id);
  const userQuery = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    enabled: applies,
  });
  const user = userQuery.data;

  if (!applies || !dateStr || !timeStr || !user) return null;
  const inside = doseFallsInOwnQuietHours({
    instant: viewerInstant(dateStr, timeStr),
    members,
    ownerId,
    viewerId,
    viewerTimezone: user.timezone,
    quietHoursStart: user.quiet_hours_start,
    quietHoursEnd: user.quiet_hours_end,
  });
  if (!inside) return null;

  return (
    <p
      role="status"
      data-testid="dose-quiet-hours-note"
      className="m-0 text-sm text-amber-deep text-balance"
    >
      {t('addEvent.quietHoursDoseWarning')}
    </p>
  );
}
