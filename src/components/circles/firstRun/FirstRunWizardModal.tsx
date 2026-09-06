import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { DrugSearchResult } from '@/api/drugs';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { CreateEventRequest } from '@/api/calendarEvents';
import { AddEventModal } from '@/components/calendar/AddEventModal';
import { InviteMemberModal } from '@/components/members/InviteMemberModal';
import { Button, ConfirmDialog, Modal, useToast } from '@/components/ui';
import { useCreateEvent } from '@/hooks/useCalendarEvents';
import { useCircle } from '@/hooks/useCircle';
import { Analytics } from '@/lib/analytics';
import { getDeviceTimezone } from '@/utils/timezone';
import {
  FIRST_RUN_DEFAULT_PRESET,
  FIRST_RUN_SCHEDULE_PRESETS,
  buildFirstRunMedication,
  buildSiblingDoseRequests,
  isFirstRunDosePastDue,
  requiresFullForm,
  viewerToday,
  type FirstRunRecurrence,
} from '@/utils/firstRunMedication';
import {
  firstRunActionRoute,
  type FirstRunAction,
  type FirstRunModal,
} from './firstRunActionRoute';
import {
  ChooseActionStep,
  FullDetailsLink,
  MedicationNameStep,
  RepeatStep,
  ScheduleStep,
  type ScheduleSelection,
} from './steps';

/**
 * The post-create first run: three questions instead of the full form's ~14.
 *
 * PORT of `mobile/src/screens/onboarding/FirstRunWizardScreen.tsx`. The
 * decision logic is NOT re-derived here — every wire value comes from
 * `utils/firstRunMedication`, so payload parity with AddEventModal (and with
 * mobile) is a unit assertion rather than a rendered-screen comparison.
 *
 * WHY IT EXISTS: only 46% of users who start adding a medication finish,
 * because the full form asks ~14 questions of someone who has owned a care
 * circle for four seconds. Web had no equivalent at all — `CreateCircleModal`
 * navigated to an empty circle, which is exactly the moment this addresses.
 *
 * MOUNTED OVER THE CIRCLE OVERVIEW, which is what lets two of its three
 * non-medication hand-offs be in-place modal swaps rather than navigations:
 * nothing is pushed, so nothing can be left behind for the user to return to.
 * Mobile has to reset its stack to get the same guarantee.
 */

type Step = 'choose' | 'what' | 'when' | 'repeat';

/** Left to right, and the order Back walks in reverse. */
const STEP_ORDER: Step[] = ['choose', 'what', 'when', 'repeat'];

export interface FirstRunWizardModalProps {
  circleId: string;
  /** The care recipient's name, for the step copy. */
  circleName: string;
  /** Dismiss — the host clears whatever made the wizard render. */
  onClose: () => void;
}

export function FirstRunWizardModal({
  circleId,
  circleName,
  onClose,
}: FirstRunWizardModalProps): ReactElement {
  const { t } = useTranslation(['circles', 'calendar', 'common']);
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { circle, canEdit } = useCircle(circleId);
  const createEvent = useCreateEvent(circleId);

  /**
   * THE ZONE A DOSE IS STORED IN, with AddEventModal's exact precedence plus
   * mobile's device fallback.
   *
   * `scheduled_date` / `scheduled_time` are naive local values in the CARE
   * RECIPIENT's frame, and `care_recipient_timezone` is the one to use for
   * medications. NOT the device zone with the circle as a fallback: the
   * circle's zone comes from a STORED PROFILE value, never from the device, so
   * the two diverge whenever a profile zone is stale or the owner is
   * travelling — signed up in New York, creating a circle from Denver, and a
   * device-zone dose lands two hours off on every other surface.
   *
   * Written out here rather than taken from `useCircle().timezone` because that
   * hook's fallback chain is `care_recipient_timezone || 'America/New_York'` —
   * it has no device step. Mobile's is
   * `circle?.care_recipient_timezone || deviceTimezone || 'America/New_York'`,
   * and the two platforms must agree on the whole chain, not just its head.
   *
   * THE CACHE CAN BE COLD AT FIRST RENDER. `useCreateCircle` invalidates the
   * circles list and never seeds this circle's detail, and the overview and this
   * wizard mount in the same commit — so nothing has fetched it yet. It resolves
   * before Save in practice only because the user spends seconds answering three
   * questions. On a failed fetch (offline, or a no-retry FORBIDDEN / NOT_FOUND)
   * `circle` stays undefined, which is why the fallback is a LAST RESORT and
   * `isTimezoneUnresolved` below refuses the save outright rather than letting it
   * silently persist device-zone dates.
   */
  const careRecipientTimezone =
    circle?.care_recipient_timezone || getDeviceTimezone() || 'America/New_York';
  /** No circle means no trustworthy zone — the same refusal AddEventModal makes. */
  const isTimezoneUnresolved = !circle;

  const [step, setStep] = useState<Step>('choose');
  const [name, setName] = useState('');
  /** RxNorm row behind a PICKED name; cleared by the autocomplete on hand-edit. */
  const [selectedDrug, setSelectedDrug] = useState<DrugSearchResult | null>(null);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [dosage, setDosage] = useState('');
  /**
   * Stored WHOLESALE — `ScheduleStep.onChange` emits one `ScheduleSelection`,
   * never a partial. Merging the two fields separately is how a preset chip
   * could leave a stale `customTime` behind it.
   */
  const [schedule, setSchedule] = useState<ScheduleSelection>({
    presetKey: FIRST_RUN_DEFAULT_PRESET,
    customTime: null,
  });
  const [recurrence, setRecurrence] = useState<FirstRunRecurrence>('daily');
  const [saving, setSaving] = useState(false);
  /** The in-place hand-off currently showing in place of the wizard, if any. */
  const [handoff, setHandoff] = useState<FirstRunModal | null>(null);
  /**
   * Set by a hand-off modal's success callback. Its `onClose` then means one
   * of two things: after a save, the wizard is finished and closes with it;
   * before one (Cancel, ×, Escape), the user picked the wrong card or wants
   * to change an answer, so the wizard comes back exactly where it was —
   * step ① for appointment/invite, the populated step for the full form.
   *
   * Mobile cannot do this: it resets the stack on hand-off because the
   * screen's own "Done" would otherwise land back on a live save button and
   * invite a duplicate. Here the saved flag closes that door instead, so the
   * wrong-card path does not have to throw the whole wizard away.
   */
  const handoffSavedRef = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** Payload held while the past-time notice shows (AddEventModal's idiom). */
  const [pendingPastTime, setPendingPastTime] = useState<CreateEventRequest | null>(null);

  /**
   * `saving` state alone cannot stop a double submit — it only takes effect
   * after React commits a render, and two clicks inside that window both enter
   * the handler, which here would create the medication twice.
   */
  const savingRef = useRef(false);

  /**
   * ONCE-PER-ENTRY FUNNEL GUARDS.
   *
   * Deliberately NOT re-armed when the user steps back to ① and picks
   * medication again: that is one wizard session, not a second attempt.
   * Re-arming would inflate `medication_creation_started` — the DENOMINATOR —
   * and push the completion rate down instead of up, which is the same metric
   * broken in the other direction.
   */
  const creationStartedRef = useRef(false);
  const firstInputTrackedRef = useRef(false);
  const scheduleSetTrackedRef = useRef(false);

  useEffect(() => {
    Analytics.firstRunStepViewed(circleId, step);
  }, [circleId, step]);

  /**
   * Hand off to the full form, carrying every answer the wizard has collected.
   *
   * `medication_creation_started` fires here with its own 'wizard_handoff'
   * source: AddEventModal is a second start for ONE user attempt, so without a
   * distinct value the wizard segment carries a denominator with no reachable
   * numerator and the form segment is inflated by an attempt it did not
   * originate.
   */
  const goToFullForm = (): void => {
    Analytics.medicationCreationStarted(circleId, 'wizard_handoff');
    setHandoff('fullForm');
  };

  /** The escape-hatch link. INERT MID-SAVE — see `FullDetailsLink`. */
  const handleFullDetailsLink = (): void => {
    if (savingRef.current) return;
    goToFullForm();
  };

  const handleAction = (action: FirstRunAction): void => {
    /**
     * A HAND-OFF THAT COULD NOT RENDER IS CANCELLED, NOT QUEUED.
     *
     * The branches at the bottom fall through when their destination is not
     * writable yet, which leaves the wizard on screen — and used to leave
     * `handoff` SET. Nothing cleared it, so it was not a no-op but a DEFERRAL:
     * it fired on whatever render came next, and the render that came next was
     * normally the user doing something else.
     *
     * The path: click "Add an appointment" on screen ① before the circle
     * detail has loaded, see nothing happen, start a medication instead, type
     * a name, pick a schedule — and the moment the circle lands, the stale
     * appointment hand-off wins the return and replaces the wizard, taking
     * every answer with it. Clearing here makes the ignored click mean what it
     * looked like it meant.
     */
    setHandoff(null);

    if (action === 'medication') {
      Analytics.firstRunActionSelected(circleId, 'medication');
      // The wizard's entry point, and the direct analogue of the full form
      // firing this on mount — this is the moment the user starts a medication.
      if (!creationStartedRef.current) {
        creationStartedRef.current = true;
        Analytics.medicationCreationStarted(circleId, 'wizard');
      }
      setStep('what');
      return;
    }

    // `skip` records a DIFFERENT event, then FALLS THROUGH to the dispatch. It
    // is the only action mapping to `{ scope: 'close' }`, so closing here
    // instead would leave that branch unreachable — dead code reading as live
    // routing.
    if (action === 'skip') {
      Analytics.firstRunSkipped(circleId, 'skip_button');
    } else {
      Analytics.firstRunActionSelected(circleId, action);
    }

    const target = firstRunActionRoute(action, { circleId });
    switch (target.scope) {
      case 'modal':
        setHandoff(target.modal);
        break;
      case 'navigate':
        onClose();
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

  const handleBack = (): void => {
    if (savingRef.current) return;
    // Same reason as in `handleAction`: navigating the wizard by hand
    // supersedes a hand-off that never got to render.
    setHandoff(null);
    const index = STEP_ORDER.indexOf(step);
    if (index > 0) setStep(STEP_ORDER[index - 1]);
  };

  /**
   * Fires `entry_field_entered` once, on the first non-empty name — per entry,
   * never per keystroke, and never carrying the value itself.
   */
  const handleChangeName = (next: string): void => {
    setName(next);
    if (next.trim().length > 0) setNameError(undefined);
    if (!firstInputTrackedRef.current && next.trim().length > 0) {
      firstInputTrackedRef.current = true;
      Analytics.entryFieldEntered(circleId, 'medication', 'wizard');
    }
  };

  /**
   * `entry_schedule_set` means "the user set a schedule", and in the wizard
   * that is true on EITHER an explicit pick or advancing past ③ on the default.
   *
   * The full form has no default — a schedule exists only once something is
   * chosen — but this step opens with a preset pre-selected, so firing only on
   * an explicit change would report that wizard users skip the schedule step
   * whenever they accept the default. That is a distortion, not a gap: the two
   * paths would stop meaning the same thing.
   */
  const markScheduleSet = (): void => {
    if (!scheduleSetTrackedRef.current) {
      scheduleSetTrackedRef.current = true;
      Analytics.entryScheduleSet(circleId, 'medication', 'wizard');
    }
  };

  const handleChangeSchedule = (next: ScheduleSelection): void => {
    setSchedule(next);
    markScheduleSet();
  };

  const handleContinue = (): void => {
    if (step === 'what') {
      // Guarded as well as disabled: `disabled` is what the eye and a screen
      // reader read; this is what makes the blank-name case unreachable however
      // the activation arrives.
      if (name.trim().length === 0) {
        setNameError(t('calendar:addEvent.validation.medicationRequired'));
        return;
      }
      setStep('when');
      return;
    }
    if (step === 'when') {
      markScheduleSet();
      setStep('repeat');
    }
  };

  /**
   * The close affordance (×, Escape, backdrop). Only asks before discarding
   * something that exists: on ① there is nothing to lose, and on ② with a blank
   * name the user has answered no question yet either.
   */
  const handleClose = (): void => {
    if (savingRef.current) return;
    if (step === 'choose') {
      Analytics.firstRunSkipped(circleId, 'close');
      onClose();
      return;
    }
    if (step === 'what' && name.trim().length === 0) {
      onClose();
      return;
    }
    setConfirmDiscard(true);
  };

  /** The network half of the save, run once every gate above has passed. */
  const persist = async (primary: CreateEventRequest, additionalTimes: string[]): Promise<void> => {
    setSaving(true);
    const todayStr = viewerToday();

    try {
      const created = await createEvent.mutateAsync(primary);
      const createdEventId = created?.id;

      const siblings = buildSiblingDoseRequests({
        primary,
        additionalTimes,
        timezone: careRecipientTimezone,
        todayStr,
        // Without an id the siblings ship no `refill_group_id`, which reinstates
        // the two-independent-bottles bug: each dose row drains its own counter
        // at half the real rate and the refill alert fires late.
        refillGroupId: createdEventId,
      });

      // A FAILURE HERE IS NOT A SUCCESS — see the partial-creation branch below.
      const failedDoseTimes: string[] = [];
      for (const sibling of siblings) {
        try {
          await createEvent.mutateAsync(sibling);
        } catch {
          // The mutation hook surfaces its own toast; record the time so the
          // caregiver is told exactly which dose is missing.
          failedDoseTimes.push(sibling.scheduled_time as string);
        }
      }

      Analytics.medicationCreated(circleId, recurrence !== 'none', 'wizard');
      Analytics.firstRunMedicationSaved({
        circleId,
        preset: schedule.presetKey,
        recurrence,
        dosageFilled: dosage.trim().length > 0,
        doseCount: additionalTimes.length + 1,
      });

      // PARTIAL CREATION IS REPORTED AS SUCH. The primary dose exists, so the
      // save did not fail — but the medication is not what the caregiver asked
      // for, and only they can decide whether to add the missing time again.
      if (failedDoseTimes.length > 0) {
        Analytics.entrySaveFailed(circleId, 'medication', 'additional_dose_create_failed');
        showToast(
          t('calendar:addEvent.alerts.someDoseTimesFailed', {
            count: failedDoseTimes.length,
            times: failedDoseTimes.join(', '),
          }),
          'error'
        );
      } else {
        showToast(t('firstRun.savedToast'), 'success');
      }

      // Either way the medication exists, so the wizard is the one place the
      // user must not return to — returning to it for a medication that now
      // exists invites a second copy of it.
      onClose();
    } catch {
      // The PRIMARY create failed, so nothing was saved. Stay on the wizard with
      // every answer intact — the retry is one click, and navigating away would
      // throw three answers away for a network blip. The mutation hook has
      // already surfaced the user-facing toast.
      Analytics.entrySaveFailed(circleId, 'medication', 'create_failed');
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleSave = (): void => {
    if (savingRef.current) return;
    /**
     * CLAIMED HERE, not after the gates below. The past-time path yields to a
     * dialog, so setting this only once network work begins leaves a window
     * where the handler has returned but nothing is marked in-flight — a second
     * click re-enters it, and the escape hatch (which reads this same ref) goes
     * live behind the dialog. `setSaving` still waits for the network, so the
     * spinner does not appear under a dialog; this ref is purely the re-entry
     * guard, and every early return below releases it.
     */
    savingRef.current = true;

    // Every save ATTEMPT, before any gate — matching the full form, which counts
    // it before validation runs. The constraint-4 hand-off below is an attempt
    // too: the user clicked save and a medication is the intended outcome.
    Analytics.entrySaveTapped(circleId, 'medication', 'wizard');

    // A stray click must never persist dates in the DEVICE's zone instead of the
    // recipient's. Its own dedicated reason so it reads in PostHog as a load
    // problem rather than hiding inside a generic failure — and it says so out
    // loud rather than looking like a dead button.
    if (isTimezoneUnresolved) {
      Analytics.entrySaveFailed(circleId, 'medication', 'timezone_unresolved');
      showToast(t('calendar:addEvent.timezoneUnresolvedNotice'), 'error');
      savingRef.current = false;
      return;
    }

    // CONSTRAINT 4, checked BEFORE any payload is built — see `requiresFullForm`.
    if (requiresFullForm(schedule.presetKey, recurrence)) {
      savingRef.current = false;
      goToFullForm();
      return;
    }

    // Built BEFORE the saving flag is shown: it is pure, and the past-time
    // confirm below needs the resolved wire values. Nothing is sent until after.
    const { primary, additionalTimes } = buildFirstRunMedication({
      name,
      dosage,
      rxcui: selectedDrug?.rxcui,
      presetKey: schedule.presetKey,
      customTime: schedule.customTime,
      recurrence,
      timezone: careRecipientTimezone,
      todayStr: viewerToday(),
    });

    /**
     * THE DEFAULT PRESET IS 08:00, AND CIRCLES GET CREATED IN THE EVENING.
     *
     * Someone setting up a circle after dinner and taking the default saves a
     * dose for 8 AM TODAY — a time that has already passed, so no reminder can
     * ever fire for it. Silent, on what is plausibly the most common path
     * through this wizard. AddEventModal warns with the same copy on the same
     * predicate; so does this, and it records the cancel.
     */
    if (isFirstRunDosePastDue(primary, careRecipientTimezone)) {
      setPendingPastTime(primary);
      return;
    }

    void persist(primary, additionalTimes);
  };

  // ── Hand-offs, rendered IN PLACE OF the wizard ────────────────────────────
  //
  // Not alongside: two stacked dialogs would trap focus in the wrong one, and
  // the wizard must not be reachable behind a form that is creating the same
  // medication.

  // GATED, all three of them, for the same reason the save is — but each on the
  // predicate its own destination actually refuses on:
  //
  //   the two AddEventModal branches → `canEdit`, because that is literally
  //     what `AddEventModal` returns null for. It is `circle?.can_edit ?? false`,
  //     so it covers the whole time the circle detail query is in flight (which
  //     is exactly when this wizard mounts — see the cold-cache note on
  //     `careRecipientTimezone`) AND the case `circle` alone MISSES: a circle
  //     that resolves without write access. `getCircleAccessLevel` fails CLOSED
  //     — a lookup error, a missing admin client, or its catch all yield
  //     `can_edit: false` — and the membership row is written in a separate
  //     statement from `POST /circles`, so a detail fetch racing it comes back
  //     "not a member". Guarding on `circle` there let the branch through to a
  //     component that renders nothing.
  //   the invite branch → `circle`, because `InviteMemberModal` has no
  //     `canEdit` gate of its own and cannot return null; what it needs is the
  //     three FIELDS below, which only a resolved circle carries.
  //
  // Rendering an empty destination as this component's ENTIRE return replaces
  // the wizard with nothing: no dialog, no ×, no Escape target, and — if that
  // query fails outright (offline, a no-retry FORBIDDEN/NOT_FOUND) — no way
  // back to it at all. The first click on screen ① is the realistic path: "Add
  // an appointment" is offered before anything has had time to load.
  //
  // Falling through re-renders the wizard on the step it was on. THE HAND-OFF
  // IS NOT LATCHED WHILE IT WAITS — `handleAction` clears it — so the swap
  // happens only if the user asks again; see the note there for what deferring
  // it silently cost.
  if (handoff === 'fullForm' && canEdit) {
    const { primaryTimeForHandoff } = handoffSchedule(schedule);
    return (
      <AddEventModal
        circleId={circleId}
        initialType="medication"
        initialTitle={name.trim()}
        initialDosage={dosage.trim()}
        initialTime={primaryTimeForHandoff}
        initialRecurrence={recurrence === 'none' ? null : recurrence}
        onSaved={handleHandoffSaved}
        onClose={handleHandoffClose}
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
        onInvited={handleHandoffSaved}
        onClose={handleHandoffClose}
      />
    );
  }

  const stepIndex = STEP_ORDER.indexOf(step);
  const isLastStep = step === 'repeat';

  return (
    <>
      <Modal
        // One heading per dialog: the per-step `StepHeading` below is the
        // visible title, so the modal-level title here is hidden — it still
        // labels the dialog (aria-labelledby → the sr-only h2 Modal keeps in
        // the tree), it just does not duplicate StepHeading's h3 as a second
        // visible heading, and `hideTitle` also collapses the header band so
        // it does not read as an empty blank strip above the ×.
        title={t('quickWin.title')}
        hideTitle
        onClose={handleClose}
        closeLabel={t('firstRun.close')}
        size="md"
        // A stray backdrop click must not throw away three answers.
        closeOnBackdropClick={false}
        footer={
          step === 'choose' ? (
            // DOCUMENTED EXCEPTION to "every footer keeps one filled primary":
            // the four option cards in the body ARE this step's primary
            // actions — each both selects AND advances in one tap. A footer
            // "Continue" here would silently pick one of them on the user's
            // behalf (which one is not obvious from the footer alone) and
            // double-fire `firstRunActionSelected` /
            // `medicationCreationStarted` for whichever action it routed to.
            // Skip is the only footer-level action a pure-choice step needs.
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => handleAction('skip')}>
                {t('quickWin.skipForNow')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex justify-end gap-3">
                <Button variant="ghost" onClick={handleBack} disabled={saving}>
                  {t('firstRun.back')}
                </Button>
                <Button
                  onClick={isLastStep ? handleSave : handleContinue}
                  disabled={saving || (step === 'what' && name.trim().length === 0)}
                >
                  {isLastStep
                    ? saving
                      ? t('firstRun.saving')
                      : t('firstRun.save')
                    : t('firstRun.continue')}
                </Button>
              </div>
              <FullDetailsLink onClick={handleFullDetailsLink} disabled={saving} />
            </div>
          )
        }
      >
        {/* Progress as four rules that fill. The accessible name is the only
            thing that carries the position — the rules themselves are decorative. */}
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={STEP_ORDER.length}
          aria-valuenow={stepIndex + 1}
          aria-label={t('firstRun.progressLabel', {
            current: stepIndex + 1,
            total: STEP_ORDER.length,
          })}
          className="flex gap-2"
        >
          {STEP_ORDER.map((key, index) => (
            <span
              key={key}
              aria-hidden="true"
              className={`h-0.5 flex-1 rounded-full ${index <= stepIndex ? 'bg-clay' : 'bg-line'}`}
            />
          ))}
        </div>

        {step === 'choose' && (
          <ChooseActionStep recipientName={circleName} onSelect={handleAction} />
        )}
        {step === 'what' && (
          <MedicationNameStep
            recipientName={circleName}
            name={name}
            dosage={dosage}
            onChangeName={handleChangeName}
            selectedDrug={selectedDrug}
            onSelectDrug={setSelectedDrug}
            onChangeDosage={setDosage}
            nameError={nameError}
          />
        )}
        {step === 'when' && (
          <ScheduleStep
            recipientName={circleName}
            presetKey={schedule.presetKey}
            customTime={schedule.customTime}
            onChange={handleChangeSchedule}
          />
        )}
        {step === 'repeat' && <RepeatStep recurrence={recurrence} onChange={setRecurrence} />}
      </Modal>

      {confirmDiscard && (
        <ConfirmDialog
          icon="alert-circle-outline"
          title={t('firstRun.discardTitle')}
          message={t('firstRun.discardMessage')}
          confirmLabel={t('firstRun.discardConfirm')}
          cancelLabel={t('common:cancel')}
          // Its own label rather than ConfirmDialog's cancelLabel fallback: two
          // controls named "Cancel" in one dialog is ambiguous to anyone reading
          // it by accessible name rather than by shape (WCAG SC 2.4.6).
          closeLabel={t('firstRun.discardClose')}
          destructive
          onConfirm={() => {
            setConfirmDiscard(false);
            onClose();
          }}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}

      {pendingPastTime && (
        <ConfirmDialog
          icon="time-outline"
          iconTone="clay"
          title={t('calendar:addEvent.alerts.pastTimeTitle')}
          message={t('calendar:addEvent.alerts.pastTimeMessage')}
          confirmLabel={t('calendar:addEvent.alerts.continue')}
          cancelLabel={t('common:cancel')}
          closeLabel={t('calendar:addEvent.alerts.closePastTime')}
          onConfirm={() => {
            const primary = pendingPastTime;
            setPendingPastTime(null);
            // Re-derived rather than stashed alongside the payload: the schedule
            // answer has not changed since `handleSave` built it, and one source
            // for the dose times is one fewer thing that can disagree.
            const { additionalTimes } = buildFirstRunMedication({
              name,
              dosage,
              rxcui: selectedDrug?.rxcui,
              presetKey: schedule.presetKey,
              customTime: schedule.customTime,
              recurrence,
              timezone: careRecipientTimezone,
              todayStr: viewerToday(),
            });
            void persist(primary, additionalTimes);
          }}
          onCancel={() => {
            Analytics.entrySaveFailed(circleId, 'medication', 'past_time_cancelled');
            setPendingPastTime(null);
            savingRef.current = false;
          }}
        />
      )}
    </>
  );
}

/**
 * The single time the full form can accept from a hand-off.
 *
 * A multi-dose preset loses its extra dose times here, because AddEventModal has
 * exactly one time field — see the KNOWN GAP note on its `initialTime` prop.
 * Extracted so that limitation is named in one place instead of implied by a
 * `[0]` index.
 */
function handoffSchedule(schedule: ScheduleSelection): { primaryTimeForHandoff: string } {
  if (schedule.presetKey === 'custom') {
    return { primaryTimeForHandoff: schedule.customTime ?? '' };
  }
  const preset = FIRST_RUN_SCHEDULE_PRESETS.find((p) => p.key === schedule.presetKey);
  return { primaryTimeForHandoff: preset?.times[0] ?? '' };
}
