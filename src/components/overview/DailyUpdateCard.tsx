import { useEffect, useId, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getCurrentUser, type NotificationPreferences } from '@/api/users';
import { isDailyUpdateEnabled } from '@/api/dailyUpdate';
import { ConfirmDialog, Eyebrow, Icon, Sheet, Text, useToast } from '@/components/ui';
import { DailyUpdateSections } from '@/components/dailyUpdate/DailyUpdateSections';
import { useDailyUpdate, useDailyUpdateWindow } from '@/hooks/useDailyUpdate';
import { useUpdateNotificationPrefs } from '@/hooks/useProfile';
import { Analytics } from '@/lib/analytics';
import {
  isDailyUpdateDismissed,
  markDailyUpdateDismissed,
  markDailyUpdateShown,
  wasDailyUpdateShown,
} from '@/lib/dailyUpdateStorage';
import { groupPatchBody, groupOn, type NotificationPrefs } from '@/lib/notificationGroups';
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
 *   - the viewer's "Daily update & tips" preference is on;
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
  const { t } = useTranslation(['dailyUpdate', 'common']);
  const { showToast } = useToast();
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
  const [turnedOff, setTurnedOff] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const updatePrefs = useUpdateNotificationPrefs();

  const data = isDailyUpdateEnabled(query.data) ? query.data : null;
  const dismissed =
    localDate !== null &&
    (dismissedDate === localDate || isDailyUpdateDismissed(circleId, localDate));

  const visible =
    win !== null &&
    win.inWindow &&
    tipsOn &&
    !isRecipient &&
    !turnedOff &&
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
    return confirmOpen ? renderConfirm() : null;
  }

  const name = data.recipient_name?.trim();
  const heading = name ? t('heading', { name }) : t('headingSelfFallback');
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

  function handleTurnOff(): void {
    if (prefs === null) return;
    setConfirmOpen(false);
    // Optimistic: hide now, restore if the save fails (the mutation's own
    // onError shows the "couldn't save" toast).
    setTurnedOff(true);
    updatePrefs.mutate(groupPatchBody(prefs, 'tips', false) as Partial<NotificationPreferences>, {
      onSuccess: () => {
        Analytics.dailyUpdateTurnedOff();
        showToast(t('turnedOffToast'), 'success');
      },
      onError: () => setTurnedOff(false),
    });
    document.getElementById('main')?.focus();
  }

  function renderConfirm(): ReactElement {
    return (
      <ConfirmDialog
        title={t('turnOffConfirm.title')}
        message={t('turnOffConfirm.body')}
        confirmLabel={t('turnOffConfirm.confirm')}
        cancelLabel={t('turnOffConfirm.cancel')}
        closeLabel={t('common:close')}
        onConfirm={handleTurnOff}
        onCancel={() => setConfirmOpen(false)}
      />
    );
  }

  return (
    <>
      <Sheet
        as="section"
        aria-labelledby={headingId}
        padding="none"
        className="px-[22px] py-5"
        data-testid="daily-update-card"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow color="moss" deep>
              {t('eyebrow')}
            </Eyebrow>
            <Text variant="h2" id={headingId} className="mt-1">
              {heading}
            </Text>
          </div>
          <button
            type="button"
            aria-label={t('dismissA11y')}
            onClick={handleDismiss}
            className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-bg-2 hover:text-ink"
          >
            <Icon name="close-outline" size="chrome" />
          </button>
        </div>

        <DailyUpdateSections data={data} past={false} headingLevel="h3" />

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line-2 pt-3">
          <Link
            to={`${base}/daily-update`}
            state={{ dailyUpdateSource: 'card' }}
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss-deep hover:underline"
          >
            {t('open')}
          </Link>
          {isSolo && isOwner ? (
            <Link
              to={`${base}/members`}
              onClick={() => Analytics.dailyUpdateInviteTapped()}
              className="inline-flex min-h-[44px] items-center text-sm font-semibold text-moss-deep hover:underline"
            >
              {t('soloInvite')}
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={prefs === null || updatePrefs.isPending}
            className="ml-auto inline-flex min-h-[44px] items-center text-sm text-ink-2 underline underline-offset-2 hover:text-ink disabled:opacity-50"
          >
            {t('turnOff')}
          </button>
        </div>
      </Sheet>
      {confirmOpen ? renderConfirm() : null}
    </>
  );
}

export default DailyUpdateCard;
