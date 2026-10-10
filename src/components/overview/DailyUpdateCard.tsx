import { useEffect, useId, useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCurrentUser } from '@/api/users';
import { isDailyUpdateEnabled } from '@/api/dailyUpdate';
import { DailyUpdateCardView } from '@/components/dailyUpdate/DailyUpdateCardView';
import { useDailyUpdate, useDailyUpdateWindow } from '@/hooks/useDailyUpdate';
import { Analytics } from '@/lib/analytics';
import {
  isDailyUpdateDismissed,
  markDailyUpdateDismissed,
  markDailyUpdateShown,
  wasDailyUpdateShown,
} from '@/lib/dailyUpdateStorage';
import { groupOn, type NotificationPrefs } from '@/lib/notificationGroups';
import { queryKeys } from '@/lib/queryKeys';
import { useAuthStore } from '@/store/authStore';

export interface DailyUpdateCardProps {
  circleId: string;
  /** The recipient's zone. The caller gates on it being known (never a placeholder). */
  timezone: string;
  isOwner: boolean;
  /** The viewer IS the care recipient (P2: the recipient never sees the card). */
  isRecipient: boolean;
}

/**
 * Home "Daily update" card (docs/plans/daily-update.md §5.1, §6). The first
 * content block under the hero, visible only when ALL of:
 *
 *   - 19:00 ≤ recipient wall time < 24:00 (re-evaluated at the boundaries and
 *     whenever the tab comes back, see `useDailyUpdateWindow`);
 *   - the server says enabled + eligible + has_activity for TODAY's date;
 *   - the viewer's "Daily update & tips" preference is on (Profile's switch is
 *     the only way to turn it off; the card has no "Turn off" link);
 *   - it was not dismissed on this browser for this recipient-day.
 *
 * View-only members see it (P3); the recipient never does (P2).
 */
export function DailyUpdateCard({
  circleId,
  timezone,
  isOwner,
  isRecipient,
}: DailyUpdateCardProps): ReactElement | null {
  const headingId = useId();
  const win = useDailyUpdateWindow(timezone);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: user } = useQuery({
    queryKey: queryKeys.currentUser,
    queryFn: getCurrentUser,
    enabled: isAuthenticated,
  });
  const prefs: NotificationPrefs | null = user?.notification_preferences
    ? { ...user.notification_preferences }
    : null;
  const tipsOn = prefs !== null && groupOn(prefs, 'tips');

  const localDate = win?.localDate ?? null;
  const query = useDailyUpdate(
    circleId,
    localDate,
    Boolean(win?.inWindow) && tipsOn && !isRecipient
  );

  const [dismissedDate, setDismissedDate] = useState<string | null>(null);

  const data = isDailyUpdateEnabled(query.data) ? query.data : null;
  const dismissed =
    localDate !== null &&
    (dismissedDate === localDate || isDailyUpdateDismissed(circleId, localDate));

  const visible =
    win !== null &&
    win.inWindow &&
    tipsOn &&
    !isRecipient &&
    !dismissed &&
    data !== null &&
    data.eligible &&
    data.has_activity &&
    data.is_today &&
    data.date === win.localDate &&
    // The server's instant wins over a skewed device clock: never show a day
    // whose window the server says has closed.
    Date.now() < Date.parse(data.window.closes_at);

  const hasStillToDo = data !== null && data.still_to_do.length > 0;
  const isSolo = data?.is_solo === true;

  useEffect(() => {
    if (!visible || localDate === null) return;
    if (wasDailyUpdateShown(circleId, localDate)) return;
    markDailyUpdateShown(circleId, localDate);
    Analytics.dailyUpdateCardShown({
      is_owner: isOwner,
      is_solo: isSolo,
      has_still_to_do: hasStillToDo,
    });
  }, [visible, circleId, localDate, isOwner, isSolo, hasStillToDo]);

  if (!visible || data === null || localDate === null) {
    return null;
  }

  const base = `/circles/${circleId}`;

  function handleDismiss(): void {
    if (localDate === null) return;
    markDailyUpdateDismissed(circleId, localDate);
    setDismissedDate(localDate);
    Analytics.dailyUpdateDismissed();
    // The card (and the focused X) is about to unmount: hand focus to the
    // page's main landmark instead of dropping it on <body>.
    document.getElementById('main')?.focus();
  }

  return (
    <DailyUpdateCardView
      data={data}
      circleId={circleId}
      headingId={headingId}
      inviteTo={isSolo && isOwner ? `${base}/members` : null}
      onInvite={() => {
        Analytics.dailyUpdateInviteTapped();
        Analytics.dailyUpdateRowTapped('invite', 'card');
      }}
      onRowTap={(row) => Analytics.dailyUpdateRowTapped(row, 'card')}
      onDismiss={handleDismiss}
    />
  );
}

export default DailyUpdateCard;
