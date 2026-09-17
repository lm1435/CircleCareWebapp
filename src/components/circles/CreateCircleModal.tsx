import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createCircleSchema, type CreateCircleRequest } from '@/api/circles';
import { useCreateCircle } from '@/hooks/useCircleAdmin';
import { useCircles } from '@/hooks/useCircles';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useAuth } from '@/hooks/useAuth';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { Analytics } from '@/lib/analytics';
import { classifyFailureCode } from '@/lib/apiErrors';
import { trackOnboardingCompleted } from '@/lib/onboardingAnalytics';
import {
  deferFirstRun,
  firstRunNavigationState,
  markOnboardingPaywallSeen,
  shouldShowOnboardingPaywall,
} from '@/lib/onboardingPaywall';
import { Button, DateField, Modal, TextField, Toggle, useToast, useZodForm } from '@/components/ui';

// Plan Stage 8, Task 8.6c — circle create modal.
//
// PORT of mobile/src/screens/circle/CreateCircleScreen.tsx (the create form +
// is_self_care toggle), reduced to the parity-relevant fields. The mobile
// relationship-chip / quick-win flow is mobile-onboarding chrome, not part of
// the create contract — web keeps the plain form the backend expects:
//   { recipient_name, recipient_dob?, recipient_conditions?, is_self_care }.
//
// Self-care: like mobile, the care recipient IS the current user, so the name
// field is hidden and we resolve the user's own name on submit (falling back to
// a localized label when the profile has no name yet). The backend then sets
// is_care_recipient on the owner membership.
//
// On success we close and navigate to the new circle's calendar. Freemium 402 /
// 403 CIRCLE_LIMIT_REACHED toasts are surfaced by useCreateCircle.

export interface CreateCircleModalProps {
  onClose: () => void;
  /**
   * Leave this form and open the JOIN flow instead.
   *
   * Optional, and the affordance below renders only when it is supplied —
   * the caller has to actually own a join surface for the offer to be honest.
   * The owner is CirclePickerPage, which holds both modal flags, so switching
   * is a close-then-open between siblings rather than a modal nested in a
   * modal.
   *
   * This exists because the create form otherwise has NO exit that leads
   * anywhere: an invited family member who opened it can only finish creating
   * a circle nobody needs, or cancel. Mobile has the same gap on
   * CreateCircleScreen.
   */
  onJoinInstead?: () => void;
}

export function CreateCircleModal({
  onClose,
  onJoinInstead,
}: CreateCircleModalProps): ReactElement {
  const { t } = useTranslation('circles');
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();

  const create = useCreateCircle();
  const form = useZodForm(createCircleSchema, ['recipient_name', 'recipient_dob']);
  // See the long comment at the `create.mutate` call below: `useZodForm.submit`
  // is synchronous and knows nothing about the request it triggers, so the
  // in-flight guard belongs here, at the call site that owns the mutation.
  const submitGuard = useSubmitGuard();

  // ONBOARDING PAYWALL GATE INPUTS. Both are read from caches this page has
  // already warmed (the picker renders the circle list and the
  // needs-selection banner), so neither adds a request.
  //
  // `circles` is READ AT SUBMIT TIME, from the closure the submit handler
  // captured, and that is the point: `useCreateCircle` invalidates
  // `queryKeys.circles` in its own onSuccess, so by the time this component's
  // onSuccess runs the list is refetching and "did the user have zero circles"
  // is no longer answerable from it.
  const { data: circles } = useCircles();
  const { data: subscription } = useSubscriptionStatus();

  const [recipientName, setRecipientName] = useState('');
  const [recipientDob, setRecipientDob] = useState('');
  const [isSelfCare, setIsSelfCare] = useState(false);

  // A plain `autoFocus` on the name field below would be dead the moment it
  // renders inside Modal — the shell always claims initial focus for its
  // close button. `initialFocusRef` (passed to Modal, further down) is how
  // the field wins that race instead; self-care hides the field entirely, so
  // Modal falls back to its own close-button focus in that case.
  const nameFieldRef = useRef<HTMLInputElement>(null);

  /**
   * Map a Zod issue KEY NAME (emitted by `createCircleSchema`, never prose) to
   * a translated message. Same helper shape as VitalFormModal.messageFor —
   * unknown keys degrade to a generic localized line instead of leaking Zod's
   * English default ("String must contain at least 1 character(s)").
   */
  const messageFor = (key: string | undefined): string | undefined =>
    key ? t(`validation.${key}`, { defaultValue: t('validation.invalid') }) : undefined;

  // Opening the create modal is the start of the creation funnel.
  useEffect(() => {
    Analytics.circleCreationStarted();
  }, []);

  /** Resolve the care recipient's name — own name for self-care, else input. */
  const resolveName = (): string => {
    if (!isSelfCare) return recipientName.trim();
    const parts = [user?.first_name, user?.last_name].filter(Boolean) as string[];
    return parts.length > 0 ? parts.join(' ') : t('create.selfCareDefaultName');
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    // Snapshotted BEFORE the mutation — see the `useCircles` comment above.
    const isFirstCircle = (circles?.length ?? 0) === 0;
    const payload: CreateCircleRequest = {
      recipient_name: resolveName(),
      is_self_care: isSelfCare,
      // Self-care has no separate DOB entry; omit when empty so it doesn't trip
      // the date refinement. Conditions are NOT collected at creation (parity
      // with mobile) — set later in Circle Settings / Emergency Info.
      ...(!isSelfCare && recipientDob ? { recipient_dob: recipientDob } : {}),
    };

    form.submit(payload, (data) => {
      // THE SYNCHRONOUS DOUBLE-SUBMIT GUARD. This form had none at all — not
      // even a `create.isPending` check — because `useZodForm.submit` calls
      // `onValid` synchronously every time it is handed valid values and
      // `create.mutate(...)` returns immediately. Two submits in one tick
      // (Enter pressed twice, a double-click, a synthetic `requestSubmit()`)
      // therefore created TWO CIRCLES for one household, and fired
      // `Analytics.circleCreated` + `trackOnboardingCompleted` twice each.
      //
      // `isPending` FIRST, then the ref, per `useSubmitGuard`'s contract: the
      // state flag rejects a second press once React has committed the pending
      // render, the ref rejects the one that arrives before it. Neither
      // replaces the other. `mutate` returns immediately, so there is no
      // promise to hold the guard open — it is released in `onSettled` below.
      //
      // The SUCCESS path navigates away / closes this modal, so its `onSettled`
      // never runs (React Query drops per-call callbacks once the observer is
      // gone). That leaves the ref claimed on a component that no longer
      // exists, which is harmless; every path that stays mounted releases it.
      if (create.isPending || !submitGuard.claim()) return;
      create.mutate(data, {
        onSuccess: (circle) => {
          Analytics.circleCreated(isSelfCare);
          // R4-5: first circle created here → onboarding complete. No-op when
          // this browser already saw the user with circles ('existing' fired).
          trackOnboardingCompleted('created');
          showToast(t('create.success'), 'success');
          onClose();

          // THE ONBOARDING PAYWALL FIRES HERE, mirroring mobile's
          // `doCreate` (CreateCircleScreen.tsx:254-262) exactly: first circle,
          // free tier, never asked before. Read the long comment block above
          // that branch on mobile, and lib/onboardingPaywall.ts here, before
          // moving it — the placement has been removed and restored twice and
          // the release-cohort data is unambiguous.
          //
          // The wizard is DEFERRED, not cancelled. Mobile parks it in a ref and
          // fires it when CreateCircleScreen regains focus; on web `/upgrade`
          // is a real route, so it is parked in sessionStorage and every exit
          // from the paywall delivers it (UpgradePage), with the circle picker
          // catching a browser-Back exit. Declining leads to the wizard, never
          // to a dead end.
          if (shouldShowOnboardingPaywall({ isFirstCircle, tier: subscription?.tier })) {
            markOnboardingPaywallSeen();
            deferFirstRun({ circleId: circle.id, recipientName: data.recipient_name });
            navigate('/upgrade', { state: { paywallContext: 'onboarding' } });
            return;
          }

          // Land on the new circle's overview — the get-started checklist + helpers
          // live here, so a brand-new owner sees how to set things up.
          //
          // FIRST RUN. Landing here alone drops the owner on an EMPTY circle,
          // which is the moment the four-step wizard exists to fix (only 46% of
          // users who start adding a medication through the full form finish).
          // The flag rides in `location.state` rather than a query param so it
          // is not shareable, not bookmarkable, and vanishes on reload — this is
          // a one-time consequence of THIS create, not a property of the URL.
          // `recipientName` travels with it because the wizard's copy asks about
          // the person by name and the circle detail query has not landed yet.
          navigate(`/circles/${circle.id}`, {
            state: firstRunNavigationState(data.recipient_name),
          });
        },
        onError: (error: unknown) => {
          // PHI-safe and BOUNDED: the backend error CODE when there is one,
          // otherwise a named transport category (`timeout`, `network_error`,
          // `http_502`, ...) — never a message. The old `CIRCLE_CREATE_FAILED`
          // fallback named the ACTION rather than the failure and collapsed a
          // timeout, an offline browser and an edge 502 into one row. Mirrored
          // on mobile (mobile/src/utils/apiError.ts) so the admin digest groups
          // this event across platforms. The hook itself surfaces the toast.
          Analytics.circleCreationFailed(classifyFailureCode(error));
        },
        onSettled: submitGuard.release,
      });
    });
  };

  return (
    <Modal
      title={t('create.title')}
      onClose={onClose}
      closeLabel={t('create.close')}
      initialFocusRef={isSelfCare ? undefined : nameFieldRef}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('create.cancel')}
          </Button>
          <Button type="submit" form="create-circle-form" loading={create.isPending}>
            {create.isPending ? t('create.creating') : t('create.create')}
          </Button>
        </>
      }
    >
      <form id="create-circle-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
        <p className="m-0 text-sm text-ink-3">{t('create.subtitle')}</p>

        <Toggle
          checked={isSelfCare}
          onChange={setIsSelfCare}
          label={t('create.selfCareToggle')}
          hint={t('create.selfCareHint')}
        />

        {!isSelfCare && (
          <>
            <TextField
              ref={nameFieldRef}
              id="recipient_name"
              label={t('create.recipientName')}
              value={recipientName}
              maxLength={100}
              required
              error={messageFor(form.errors.recipient_name)}
              placeholder={t('create.recipientNamePlaceholder')}
              onChange={(e) => {
                setRecipientName(e.target.value);
                form.clearError('recipient_name');
              }}
            />
            <DateField
              id="recipient_dob"
              label={t('create.recipientDob')}
              value={recipientDob}
              error={messageFor(form.errors.recipient_dob)}
              hint={t('create.recipientDobHint')}
              onChange={(e) => {
                setRecipientDob(e.target.value);
                form.clearError('recipient_dob');
              }}
            />
          </>
        )}
      </form>

      {/* WRONG DOOR? Sits OUTSIDE the <form> on purpose: it is not a form
          control and must never be swept up by an Enter-key submit. Modest by
          design — the create flow is still the one the user chose — but it is
          the only thing on this screen that leads anywhere other than a new
          circle. */}
      {onJoinInstead ? (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 border-t border-line-2 pt-4 text-center">
          <p className="m-0 text-sm text-ink-3">{t('join.invitedPrompt')}</p>
          <Button type="button" variant="ghost" size="sm" onClick={onJoinInstead}>
            {t('join.withCode')}
          </Button>
        </div>
      ) : null}
    </Modal>
  );
}
