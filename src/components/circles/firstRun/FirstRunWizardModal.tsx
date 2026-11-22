import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AddEventModal, type FirstRunSavedItem } from '@/components/calendar/AddEventModal';
import { Button, Icon, Modal, useToast } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useCreateInvite } from '@/hooks/useInvites';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useAuthStore } from '@/store/authStore';
import { Analytics } from '@/lib/analytics';
import { firstRunFunnel } from '@/lib/firstRunFunnel';
import { consumeOnboardingPaywall, peekOnboardingPaywallPending } from '@/lib/onboardingPaywall';
import { withInviteLocale } from '@/utils/inviteShareUrl';
import { AllSetStep } from './AllSetStep';

/**
 * The post-create first run, v2 (1.4.3, docs/mocks-144/first-run-v2/plan.md):
 *
 *   first item  the REAL add form (AddEventModal) in first-run mode WITH the type switch
 *               (Medication · Appointment · Task), opening on Medication at 8:00 AM Morning;
 *               appointment / task open on 9:00 AM (tomorrow once 9:00 has passed)
 *   All set     the finish line: three rows, the Optional invite block, and two same-size buttons:
 *               "Share invite link" (browser share sheet) or "Copy invite link" (no share sheet),
 *               and "Go to Today"
 *
 * The v1 chooser ("{{name}}'s circle is ready" + quiet rows) and the payoff are gone: the one question
 * and the circle moment come before (CirclePickerPage). WEB DIFFERENCES: no reminders ask (no push),
 * no haptics; All set says reminders arrive on the phone.
 *
 * MOUNTED OVER TODAY. PAYWALL TIMING unchanged: owed at create, shown once after Go to Today
 * (first circle, free tier, not seen); every other way out leaves it owed for Today to ask.
 */

type Step = 'item' | 'allSet';

export interface FirstRunWizardModalProps {
  circleId: string;
  /** The care recipient's name, for the step copy. */
  circleName: string;
  /** Dismiss: the host clears whatever made the wizard render. */
  onClose: () => void;
}

export function FirstRunWizardModal({
  circleId,
  circleName,
  onClose,
}: FirstRunWizardModalProps): ReactElement | null {
  const { t, i18n } = useTranslation(['circles', 'members', 'invite', 'common']);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { circle, canEdit } = useCircle(circleId);
  const user = useAuthStore((s) => s.user);
  const hourCycle = useHourCycle();
  const { data: subscription } = useSubscriptionStatus();
  const createInvite = useCreateInvite(circleId);

  const [step, setStep] = useState<Step>('item');
  const [saved, setSaved] = useState<FirstRunSavedItem | null>(null);
  const savedRef = useRef<FirstRunSavedItem | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [seatFilled, setSeatFilled] = useState(false);
  const [linkPending, setLinkPending] = useState(false);
  /** ONE link per All set: a second press reuses it (one seat held), never a second invite. */
  const linkInFlightRef = useRef<Promise<string | null> | null>(null);
  const sharedRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const isSelfCare = circle?.is_self_care === true;
  const recipientName = circle?.recipient_name || circleName;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (step === 'item' && canEdit) {
      Analytics.firstRunStepViewed(circleId, 'first_med');
      firstRunFunnel.viewed('first_item', circleId);
    }
  }, [circleId, step, canEdit]);

  useEffect(() => {
    if (step !== 'allSet' || !saved) return;
    firstRunFunnel.viewed('all_set', circleId);
    Analytics.firstRunAllSetViewed({
      circleId,
      path: isSelfCare ? 'self_care' : 'owner',
      // Web cannot ask for push: reminders arrive on the phone app, never "on" here.
      remindersOn: false,
      firstItemType: saved.type,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, [step]);

  const handleItemSaved = (item: FirstRunSavedItem): void => {
    // The form calls this, then onSaved, then onClose in ONE tick: the close reads the ref.
    savedRef.current = item;
    setSaved(item);
    firstRunFunnel.completed('first_item', circleId);
  };

  /** The first-item form closed: saved -> All set; else it was "Skip for now" / x / Escape. */
  const handleItemClose = (): void => {
    if (savedRef.current) {
      setStep('allSet');
      return;
    }
    Analytics.firstRunSkipped(circleId, 'close');
    // Before Today: viewing Today ends the run, and the skip belongs to it.
    firstRunFunnel.skipped('first_item');
    firstRunFunnel.viewed('today', circleId);
    onClose();
  };

  /** Leave: the onboarding paywall once if owed (first circle, free), otherwise Today. */
  const finish = (): void => {
    if (!sharedRef.current) {
      Analytics.firstRunInviteAction({ circleId, method: 'later', completed: false });
    }
    firstRunFunnel.completed('all_set', circleId);
    const owed = peekOnboardingPaywallPending() === circleId;
    if (owed && subscription?.tier === 'free') {
      if (consumeOnboardingPaywall({ circleId })) {
        onClose();
        navigate('/upgrade', {
          state: { paywallContext: 'onboarding', paywallTrigger: 'after_first_med' },
        });
        return;
      }
    }
    firstRunFunnel.viewed('today', circleId);
    onClose();
  };

  /** Create the link invite (no email) once, when the button is pressed - never on arrival. */
  const ensureLink = (): Promise<string | null> => {
    if (inviteUrl) return Promise.resolve(inviteUrl);
    if (linkInFlightRef.current) return linkInFlightRef.current;
    setLinkPending(true);
    const pending = createInvite
      .mutateAsync({ member_type: 'caregiver' })
      .then((created) => {
        const code = created?.invite?.invite_code;
        const raw =
          created?.invite?.invite_url ??
          (code ? `${window.location.origin}/invite/${encodeURIComponent(code)}` : null);
        const url = raw ? withInviteLocale(raw, i18n.language) : null;
        setInviteUrl(url);
        return url;
      })
      .catch(() => null) // the hook already toasts the reason (seat held, offline, ...)
      .finally(() => {
        linkInFlightRef.current = null;
        setLinkPending(false);
      });
    linkInFlightRef.current = pending;
    return pending;
  };

  const shareText = (url: string): string =>
    isSelfCare
      ? t('members:invite.shareMessageSelfCare', { inviteUrl: url })
      : t('members:invite.shareMessage', { recipientName, inviteUrl: url });

  const markShared = (): void => {
    sharedRef.current = true;
    setSeatFilled(true);
  };

  const handleInvite = async (): Promise<void> => {
    const url = await ensureLink();
    if (!url) {
      Analytics.firstRunInviteAction({ circleId, method: 'share_link', completed: false });
      return;
    }
    if (canShare) {
      try {
        await navigator.share({ text: shareText(url) });
        Analytics.inviteLinkShared(circleId, 'caregiver');
        markShared();
        Analytics.firstRunInviteAction({ circleId, method: 'share_link', completed: true });
      } catch {
        // Dismissed or refused: the seat does NOT fill. The link stays on screen to copy.
        Analytics.firstRunInviteAction({ circleId, method: 'share_link', completed: false });
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      Analytics.inviteLinkCopied(circleId, 'caregiver');
      showToast(t('members:invite.linkCopied'), 'success');
      markShared();
      Analytics.firstRunInviteAction({ circleId, method: 'share_link', completed: true });
    } catch {
      // Clipboard refused: the link is on screen (read-only field) to copy by hand.
      showToast(t('members:invite.copyFailed'), 'error');
      Analytics.firstRunInviteAction({ circleId, method: 'share_link', completed: false });
    }
  };

  if (step === 'item') {
    // AddEventModal itself renders nothing until the circle detail says the viewer can edit.
    if (!canEdit) return null;
    return (
      <AddEventModal
        circleId={circleId}
        initialType="medication"
        firstRun
        firstRunTypeSwitch
        entry="first_run"
        onFirstRunItemSaved={handleItemSaved}
        onClose={handleItemClose}
      />
    );
  }

  if (!saved) return null;

  return (
    <Modal
      title={t('firstRun.payoff.eyebrow')}
      hideTitle
      onClose={finish}
      closeLabel={t('firstRun.close')}
      size="md"
      closeOnBackdropClick={false}
      initialFocusRef={headingRef}
      footer={
        <div className="flex w-full flex-col gap-2">
          <Button
            size="lg"
            fullWidth
            offlineKind="save"
            loading={linkPending}
            onClick={() => void handleInvite()}
            leftIcon={<Icon name={canShare ? 'share-outline' : 'copy-outline'} size="row" />}
            data-testid="first-run-invite-link"
          >
            {canShare ? t('members:invite.shareLink') : t('firstRun.allSet.copyInviteLink')}
          </Button>
          <Button size="lg" fullWidth variant="secondary" onClick={finish} data-testid="first-run-go-to-today">
            {t('invite:welcome.goToToday')}
          </Button>
        </div>
      }
    >
      <AllSetStep
        recipientName={recipientName}
        isSelfCare={isSelfCare}
        ownerFirstName={user?.first_name ?? undefined}
        item={saved}
        hourCycle={hourCycle}
        seatFilled={seatFilled}
        inviteUrl={inviteUrl}
        headingRef={headingRef}
      />
    </Modal>
  );
}
