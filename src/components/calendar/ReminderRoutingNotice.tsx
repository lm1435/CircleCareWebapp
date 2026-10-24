import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Sheet } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useAuthStore } from '@/store/authStore';
import { viewerOwnsCircle } from '@/lib/premiumOwnership';
import { Analytics } from '@/lib/analytics';

// Same key shape mobile uses for AsyncStorage (`notif_banner_dismissed_<id>`),
// so the two surfaces read as one product. A non-sensitive UI preference;
// guarded because localStorage throws in private-mode / storage-blocked browsers.
const dismissKey = (circleId: string): string => `notif_banner_dismissed_${circleId}`;

function readDismissed(circleId: string): boolean {
  try {
    return window.localStorage.getItem(dismissKey(circleId)) === 'true';
  } catch {
    return false;
  }
}

function writeDismissed(circleId: string): void {
  try {
    window.localStorage.setItem(dismissKey(circleId), 'true');
  } catch {
    // Storage unavailable: session-only dismissal.
  }
}

export interface ReminderRoutingNoticeProps {
  circleId: string;
  /** The calendar has at least one medication in view. */
  hasMedications: boolean;
}

/**
 * WHO GETS THE MEDICATION REMINDERS, when nobody else is set up to.
 *
 * With no care-recipient member and no medication-responsible member, the
 * backend sends the dose-time reminder AND the 15-minute alert to the circle
 * OWNER (caregivers still get the 30-minute and 1-hour alerts). Mobile used to
 * call this state "Notifications paused", which was false; both platforms now
 * show this informational line instead (mobile CalendarScreen, same copy key
 * `calendar:noCareRecipient`).
 *
 * Owner only (the copy says "you (the circle owner)"), and only while they can
 * edit: `canEdit` is fail-closed (false while loading) so it never flashes, and
 * it keeps the line off a frozen circle. Dismissable per circle.
 */
export function ReminderRoutingNotice({
  circleId,
  hasMedications,
}: ReminderRoutingNoticeProps): ReactElement | null {
  const { t } = useTranslation('calendar');
  const { circle, members, canEdit } = useCircle(circleId);
  const userId = useAuthStore((s) => s.user?.id);
  const [dismissedCircleId, setDismissedCircleId] = useState<string | null>(null);
  const dismissed = useMemo(
    () => dismissedCircleId === circleId || readDismissed(circleId),
    [dismissedCircleId, circleId]
  );

  const hasNotificationTarget = members.some(
    (m) => m.is_care_recipient || m.is_medication_responsible
  );

  if (
    dismissed ||
    !canEdit ||
    !hasMedications ||
    members.length === 0 ||
    hasNotificationTarget ||
    !viewerOwnsCircle(circle, userId)
  ) {
    return null;
  }

  return (
    <Sheet
      role="note"
      aria-labelledby="reminder-routing-notice-title"
      padding="sm"
      className="relative mb-3 flex items-start gap-2.5 pr-14"
      data-testid="reminder-routing-notice"
    >
      <span className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true">
        <Icon name="notifications-outline" size="inline" />
      </span>
      <div className="min-w-0 flex-1">
        <p id="reminder-routing-notice-title" className="m-0 text-sm font-medium text-ink">
          {t('noCareRecipient.title')}
        </p>
        <p className="m-0 mt-0.5 text-xs text-ink-3">{t('noCareRecipient.description')}</p>
      </div>
      <button
        type="button"
        onClick={() => {
          Analytics.reminderRoutingNoticeDismissed();
          writeDismissed(circleId);
          setDismissedCircleId(circleId);
        }}
        aria-label={t('common:close')}
        className="absolute top-1.5 right-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-3 transition-colors duration-fast hover:bg-bg-2 hover:text-ink"
      >
        <Icon name="close-outline" size="row" />
      </button>
    </Sheet>
  );
}
