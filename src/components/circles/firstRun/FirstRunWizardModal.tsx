import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { InviteMemberModal } from '@/components/members/InviteMemberModal';
import { Button, Modal } from '@/components/ui';
import { useCircle } from '@/hooks/useCircle';
import { useHourCycle } from '@/hooks/useHourCycle';
import { useMarkFirstDose } from '@/hooks/useMarkFirstDose';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useAuthStore } from '@/store/authStore';
import { getCircleOwnerName, viewerCanSuggestManager } from '@/lib/premiumOwnership';
import { Analytics } from '@/lib/analytics';
import { snoozeNextStep } from '@/lib/todayCoaching';
import {
  consumeOnboardingPaywall,
  peekOnboardingPaywallPending,
} from '@/lib/onboardingPaywall';
import { markItEligible, type SavedMedicationInfo } from '@/utils/firstMedSaved';
import {
  firstRunActionRoute,
  type FirstRunAction,
  type FirstRunModal,
} from './firstRunActionRoute';
import { ChooseActionStep, FirstMedPayoffStep } from './steps';

/**
 * The post-create first run (onboarding 1.3.1): Setup (1), then the ONE simple medication
 * form in first-run mode, then the payoff.
 *
 * PORT of `mobile/src/screens/onboarding/FirstRunWizardScreen.tsx`, minus the three question
 * steps: name / when / repeat are the real simple form (AddEventModal `firstRun`), so the
 * payload, timezone handling and validation are THAT form's, not a copy's.
 *
 * MOUNTED OVER TODAY, which is what lets the non-medication hand-offs be in-place modal
 * swaps rather than navigations: nothing is pushed, so nothing can be left behind.
 *
 * PAYWALL TIMING (spec section 7): circle creation only records "owed". After the payoff's
 * Continue the onboarding paywall shows exactly once (then Today). Every other way out
 * (Skip, close, an appointment / someone to help / emergency info, the first-run form closed
 * unsaved) leaves it owed, and Today shows it the next time it is on screen.
 */

type Step = 'choose' | 'payoff';

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
  const { t } = useTranslation(['circles', 'calendar', 'common', 'overview']);
  const navigate = useNavigate();
  const { circle, canEdit, isOwner } = useCircle(circleId);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const hourCycle = useHourCycle();
  const { data: subscription } = useSubscriptionStatus();
  const markFirstDose = useMarkFirstDose(circleId, 'payoff');

  const [step, setStep] = useState<Step>('choose');
  /** The in-place hand-off currently showing in place of Setup, if any. */
  const [handoff, setHandoff] = useState<FirstRunModal | null>(null);
  /** What the first-run form just saved (null = nothing / an as-needed med, no card). */
  const [saved, setSaved] = useState<SavedMedicationInfo | null>(null);
  /**
   * Set by a hand-off's success callback. Its `onClose` then means the hand-off is finished:
   * after an appointment / invite save the wizard closes with it; after the first med the
   * payoff shows. Before a save (Cancel, x, Escape) the user picked the wrong card, so
   * Setup comes back as it was (the first-run form instead counts as a skip).
   */
  const handoffSavedRef = useRef(false);
  const savedRef = useRef<SavedMedicationInfo | null>(null);
  /**
   * FOCUS: the current step's heading. Passed to the Modal as `initialFocusRef`, so the
   * wizard opening, and Setup / the payoff coming back after a hand-off (each a fresh Modal),
   * focus the heading that names what just happened instead of the x.
   */
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (step === 'choose') Analytics.firstRunStepViewed(circleId, 'choose');
  }, [circleId, step]);

  /** The first-run form is on screen (once per opening). */
  useEffect(() => {
    if (handoff === 'firstMed') Analytics.firstRunStepViewed(circleId, 'first_med');
  }, [circleId, handoff]);

  // ── Payoff: viewed, the invite snooze, and the Mark it line ──────────────
  const markItOffered = step === 'payoff' && saved !== null && canEdit && markItEligible(saved);
  useEffect(() => {
    if (step !== 'payoff') return;
    Analytics.onboardingPayoffViewed();
    // The payoff does NOT ask the invite question (decision 7); the invite comes later from
    // Today's next-step card. Same 3-day snooze as "Not now" there, so Today never asks it in
    // the session the first med was saved.
    snoozeNextStep(circleId, 'invite');
  }, [circleId, step]);
  useEffect(() => {
    if (markItOffered) Analytics.markItShown('payoff');
  }, [markItOffered]);

  const handleAction = (action: FirstRunAction): void => {
    // A hand-off that could not render is CANCELLED, not queued (see the gates below):
    // clearing here makes an ignored click mean what it looked like it meant.
    setHandoff(null);

    if (action === 'medication') {
      Analytics.firstRunActionSelected(circleId, 'medication', 'primary');
      // The funnel's denominator: this is the moment the user starts a medication.
      Analytics.medicationCreationStarted(circleId, 'wizard');
      setHandoff('firstMed');
      return;
    }

    // `skip` records a DIFFERENT event, then falls through to the dispatch (it is the only
    // action mapping to `{ scope: 'close' }`).
    if (action === 'skip') {
      Analytics.firstRunSkipped(circleId, 'skip_button');
    } else {
      Analytics.firstRunActionSelected(circleId, action, 'secondary');
    }

    const target = firstRunActionRoute(action, { circleId });
    switch (target.scope) {
      case 'modal':
        setHandoff(target.modal);
        break;
      case 'navigate':
        // NOT onClose(): closing would let Today (still mounted this tick) ask the owed
        // paywall and win the race against this navigation. The route change unmounts Today
        // and the wizard with it; the paywall is asked the next time Today shows.
        navigate(target.to);
        break;
      case 'close':
        onClose();
        break;
    }
  };

  const handleHandoffSaved = (): void => {
    handoffSavedRef.current = true;
  };

  const handleHandoffClose = (): void => {
    if (handoffSavedRef.current) {
      onClose();
      return;
    }
    setHandoff(null);
  };

  /** The first-run form saved. `info` is undefined for an as-needed medication (no card). */
  const handleFirstMedSaved = (info?: SavedMedicationInfo): void => {
    handoffSavedRef.current = true;
    // The form calls onSaved and onClose in ONE tick, before this state has rendered: the
    // close callback reads the ref, not the state.
    savedRef.current = info ?? null;
    setSaved(info ?? null);
  };

  /** The first-run form closed: saved -> payoff (or straight on for an as-needed med); else skipped. */
  const handleFirstMedClose = (): void => {
    setHandoff(null);
    if (!handoffSavedRef.current) {
      // Leaving the form unsaved returns to Today and counts as a skip for the paywall rule.
      Analytics.firstRunSkipped(circleId, 'close');
      onClose();
      return;
    }
    if (savedRef.current === null) {
      finish();
      return;
    }
    setStep('payoff');
  };
  /**
   * Leave the wizard. When the onboarding paywall is owed (first circle, free, not yet seen)
   * it shows NOW, exactly once, and Today follows its exits; otherwise straight to Today.
   * An unknown tier (still loading) fails closed here: it stays owed and Today asks.
   */
  const finish = (): void => {
    const owed = peekOnboardingPaywallPending() === circleId;
    if (owed && subscription?.tier === 'free') {
      if (
        consumeOnboardingPaywall({
          circleId,
          recipientName: circle?.recipient_name || circleName,
        })
      ) {
        onClose();
        navigate('/upgrade', {
          state: { paywallContext: 'onboarding', paywallTrigger: 'after_first_med' },
        });
        return;
      }
    }
    onClose();
  };

  /** The modal's x / Escape. On Setup that is a skip; on the payoff it is Continue. */
  const handleClose = (): void => {
    if (step === 'payoff') {
      finish();
      return;
    }
    Analytics.firstRunSkipped(circleId, 'close');
    onClose();
  };

  // ── Hand-offs, rendered IN PLACE OF Setup ─────────────────────────────────
  //
  // Not alongside: two stacked dialogs would trap focus in the wrong one. GATED, each on the
  // predicate its destination actually refuses on: the two AddEventModal branches on
  // `canEdit` (what AddEventModal itself returns null for; false while the circle detail is
  // still in flight, which is exactly when this wizard mounts), the invite branch on `circle`
  // (InviteMemberModal has no gate of its own and needs the fields below). Rendering an empty
  // destination as this component's ENTIRE return would replace Setup with nothing. Falling
  // through re-renders Setup; the hand-off is not latched while it waits.
  if (handoff === 'firstMed' && canEdit) {
    return (
      <AddEventModal
        circleId={circleId}
        initialType="medication"
        firstRun
        entry="first_run"
        onSaved={handleFirstMedSaved}
        onClose={handleFirstMedClose}
      />
    );
  }

  if (handoff === 'appointment' && canEdit) {
    return (
      <AddEventModal
        circleId={circleId}
        initialType="appointment"
        onSaved={handleHandoffSaved}
        onClose={handleHandoffClose}
      />
    );
  }

  if (handoff === 'invite' && circle) {
    return (
      <InviteMemberModal
        circleId={circleId}
        isSelfCare={circle.is_self_care}
        circleName={circle.name}
        recipientName={circle.recipient_name}
        viewerIsOwner={isOwner}
        ownerName={getCircleOwnerName(circle)}
        canSuggestManager={viewerCanSuggestManager(circle, currentUserId)}
        onInvited={handleHandoffSaved}
        onClose={handleHandoffClose}
      />
    );
  }

  const isPayoff = step === 'payoff' && saved !== null;

  return (
    <Modal
      // One heading per dialog: the per-step heading below is the visible title, so the
      // modal-level title is hidden (it still names the dialog for assistive tech).
      title={t('quickWin.title')}
      hideTitle
      onClose={handleClose}
      closeLabel={t('firstRun.close')}
      size="md"
      // A stray backdrop click must not dismiss the setup.
      closeOnBackdropClick={false}
      initialFocusRef={stepHeadingRef}
      footer={
        isPayoff ? (
          <div className="flex justify-end">
            <Button ref={continueRef} onClick={finish} data-testid="first-run-continue">
              {t('firstRun.continue')}
            </Button>
          </div>
        ) : (
          // DOCUMENTED EXCEPTION to "every footer keeps one filled primary": Setup's one
          // filled primary ("Add the first med") is in the BODY, directly above the quieter
          // rows it outranks, and each of them both selects AND advances in one tap. Skip is
          // the only footer-level action a pure-choice step needs.
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => handleAction('skip')}>
              {t('quickWin.skipForNow')}
            </Button>
          </div>
        )
      }
    >
      {isPayoff && saved ? (
        <FirstMedPayoffStep
          recipientName={circleName}
          isSelfCare={circle?.is_self_care === true}
          saved={saved}
          hourCycle={hourCycle}
          headingRef={stepHeadingRef}
          onMarked={() => continueRef.current?.focus()}
          markIt={
            markItOffered
              ? {
                  pending: markFirstDose.pending,
                  done: markFirstDose.done,
                  onMark: () => {
                    if (saved.eventId) {
                      void markFirstDose.mark({
                        eventId: saved.eventId,
                        time: saved.doses[0].scheduledTime,
                      });
                    }
                  },
                }
              : null
          }
        />
      ) : (
        <ChooseActionStep
          recipientName={circleName}
          isSelfCare={circle?.is_self_care === true}
          onSelect={handleAction}
          headingRef={stepHeadingRef}
        />
      )}
    </Modal>
  );
}
