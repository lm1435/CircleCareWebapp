import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Button, Modal, RadioGroup, Text, TextArea } from '@/components/ui';
import { useAuthStore } from '@/store/authStore';
import { useGuardedSubmit } from '@/hooks/useGuardedSubmit';
import { CANCEL_REASONS, submitCancellationFeedback, type CancelReason } from '@/api/feedback';
import { getSubscriptionStatus, type CancelPromptStatus } from '@/api/subscriptionStatus';
import { queryKeys } from '@/lib/queryKeys';
import { peekDeferredFirstRun } from '@/lib/onboardingPaywall';
import { Analytics } from '@/lib/analytics';
import {
  evaluateCancelReasonEligibility,
  hasAskedCancelReason,
  markCancelReasonAsked,
  markCancelReasonEvaluatedThisPageLoad,
  resetCancelReasonEvaluation,
  wasCancelReasonEvaluatedThisPageLoad,
} from '@/lib/cancelReasonPrompt';

/**
 * "Why did you turn off renewal?" — web port of mobile's CancelReasonModal.
 * Asked once, on a calm signed-in page load, of a subscriber whose account
 * the RevenueCat webhook cached as having unsubscribed. No upsell, no
 * resubscribe CTA: this surface only listens. Spec:
 * docs/plans/cancel-reason-prompt.md ("Web companion").
 *
 * OPTION B (decided 2026-09-21): eligibility comes from `cancelPrompt` on
 * `GET /subscription-status` — a webhook-synced cache, never RevenueCat in
 * the browser. This component (and this whole feature) no longer imports
 * `@/lib/purchases` / purchases-js at all: no SDK chunk, no
 * `getCustomerInfo()` request, on this route, for anyone, owner or not. The
 * previous version loaded the ~177 KB purchases-js chunk on the home page for
 * every circle OWNER specifically to avoid it for members; that gate is gone
 * too — see `useCancelPromptFromCache` below for why it is no longer needed.
 *
 * WHETHER to ask is decided in lib/cancelReasonPrompt.ts; this component owns
 * WHEN (the settle delay and the gates) and the UI.
 *
 * Mounted once, beside the authenticated <Outlet /> in router.tsx, so it
 * unmounts with the session (AuthGuard redirects on sign-out).
 */

/** Lets the home page settle before anything is evaluated (mobile: same 2 s). */
export const PRESENT_DELAY_MS = 2000;

/** How long the thanks state stays up before the dialog closes itself. */
export const THANKS_DURATION_MS = 1500;

/** Matches the backend's cancellation description cap. */
const MAX_COMMENT_LENGTH = 1000;

/**
 * The web equivalents of mobile's CircleList / CircleDetail: the circle picker
 * (`/circles`) and a circle's Overview (`/circles/:circleId`, index route).
 * `/upgrade` (the paywall) and every sub-page are deliberately excluded.
 */
export function isCancelReasonHomePath(pathname: string): boolean {
  return /^\/circles(\/[^/]+)?\/?$/.test(pathname);
}

/**
 * NEVER TWO MODALS AT ONCE. Web has no WhatsNew or earned-upsell surface; the
 * ones that exist — the first-run wizard, create/join circle, the downgrade
 * CircleSelectionModal, any open form — all render through `Modal`
 * (`aria-modal="true"`), so one DOM check covers them and every future one. A
 * first run parked behind the onboarding paywall is checked too.
 */
function anotherSurfaceIsOpen(): boolean {
  if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) {
    return true;
  }
  return peekDeferredFirstRun() !== null;
}

/**
 * NO OWNER GATE ANY MORE (decided 2026-09-21, replacing the "owners only"
 * gate this component used to apply against the RevenueCat SDK). The old gate
 * existed to keep the purchases-js chunk and RC request off a member's page
 * load, since only owners pay. That cost is gone entirely now — there is no
 * SDK and no extra request for ANYONE, owner or member — and the gate is not
 * needed for correctness either: `cancelPrompt` is read off the SIGNED-IN
 * USER'S OWN `users` row (`req.userId` in `GET /subscription-status`), keyed
 * to whichever account actually turned its own renewal off. A member's own
 * row only ever has it set if THEY personally had (and cancelled) a
 * subscription — never because of who owns a circle they belong to. So
 * checking circle ownership here would filter on the wrong axis, for no
 * remaining benefit.
 *
 * Reads the EXISTING `GET /subscription-status` cache
 * (`queryKeys.subscriptionStatus`) through a PASSIVE observer — the same
 * `enabled: false` + `select` pattern the removed circle-owner gate used
 * against `GET /circles`: this component never fetches on its own. On both
 * routes this prompt evaluates (`/circles` via `CirclePickerPage`,
 * `/circles/:circleId` via `AppLayout`), `NeedsCircleSelectionBanner` is
 * ALREADY mounted and already calls `useSubscriptionStatus()` with its normal
 * `enabled: true` fetch — so by the time this component's 2 s settle timer
 * fires, the query is either already resolved or already in flight, and this
 * hook only ever observes that SAME query's cache entry. Zero incremental
 * requests, without depending on staleTime/mount-order luck the way sharing
 * the enabled hook directly would.
 */
function useCancelPromptFromCache(): CancelPromptStatus | null | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.subscriptionStatus,
    queryFn: getSubscriptionStatus,
    enabled: false,
    select: (status) => status.cancelPrompt ?? null,
  });
  return data;
}

type ShownContext = {
  userId: string;
  entitlementActive: boolean;
  expirationDateMs: number;
  periodType: string;
  unsubscribeDetectedAtMs: number;
  isSandbox: boolean;
};

/**
 * The gate. Renders nothing for everyone who is never asked — nearly every
 * load — and costs one timer. No network request of its own: `cancelPrompt`
 * only ever reads whatever `GET /subscription-status` already put in the
 * React Query cache.
 */
export function CancelReasonPrompt(): ReactElement | null {
  const userId = useAuthStore((state) => state.user?.id);
  const { pathname } = useLocation();
  const onHome = isCancelReasonHomePath(pathname);
  const cancelPrompt = useCancelPromptFromCache();

  // Read at the moment of showing, after async work, so it must be current.
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const [context, setContext] = useState<ShownContext | null>(null);

  // Presented and not yet closed by the user. Read on unmount (sign-out mid-
  // dialog) to hand the page load its evaluation back — nothing was written.
  const openRef = useRef(false);
  useEffect(() => {
    return () => {
      if (openRef.current) {
        openRef.current = false;
        resetCancelReasonEvaluation();
      }
    };
  }, []);

  useEffect(() => {
    if (!userId || !onHome) return;
    // WAIT FOR THE CACHE — before the timer, so a page load where
    // GET /subscription-status has not resolved yet does not spend this
    // load's ONE evaluation on "no data" and answer "not eligible" forever.
    // `cancelPrompt` is a dependency: when `NeedsCircleSelectionBanner`'s own
    // fetch resolves (elsewhere in the tree — none is added here) this effect
    // re-runs and the 2 s settle delay starts then. `null` (query resolved,
    // genuinely nothing to ask about) proceeds immediately; only `undefined`
    // (not resolved yet) waits.
    if (cancelPrompt === undefined) return;
    if (wasCancelReasonEvaluatedThisPageLoad()) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      // Claimed only once the delay has elapsed ON a home page: landing on a
      // sub-page, or leaving home within 2 s, does not burn this load's one
      // evaluation.
      if (wasCancelReasonEvaluatedThisPageLoad()) return;
      markCancelReasonEvaluatedThisPageLoad();

      void (async () => {
        try {
          if (anotherSurfaceIsOpen()) return;

          const eligibility = evaluateCancelReasonEligibility(cancelPrompt, userId, Date.now());
          if (!eligibility.eligible) return;
          if (await hasAskedCancelReason(userId, eligibility.unsubscribeDetectedAtMs)) return;

          // THE MOMENT OF SHOWING. No SDK/network fetch happens here any more
          // (the data was already in cache), but the re-check stays: the
          // WebCrypto hashing inside `hasAskedCancelReason` still takes a
          // tick, and a modal could have opened during it.
          if (cancelled) return;
          if (!isCancelReasonHomePath(pathRef.current)) return;
          if (anotherSurfaceIsOpen()) return;

          openRef.current = true;
          setContext({
            userId,
            entitlementActive: eligibility.entitlementActive,
            expirationDateMs: eligibility.expirationDateMs,
            periodType: eligibility.periodType,
            unsubscribeDetectedAtMs: eligibility.unsubscribeDetectedAtMs,
            isSandbox: eligibility.isSandbox,
          });
          Analytics.cancelReasonPromptShown({
            periodType: eligibility.periodType,
            daysSinceUnsubscribe: Math.max(
              0,
              Math.floor((Date.now() - eligibility.unsubscribeDetectedAtMs) / 86_400_000)
            ),
            entitlementActive: eligibility.entitlementActive,
            isSandbox: eligibility.isSandbox,
          });
        } catch {
          // Storage/WebCrypto failure: fail quiet. Nothing to tell a user who
          // was never going to be asked.
        }
      })();
    }, PRESENT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [userId, onHome, cancelPrompt]);

  if (!context) return null;
  return (
    <CancelReasonDialog
      context={context}
      onClose={() => {
        openRef.current = false;
        setContext(null);
      }}
    />
  );
}

/** Web port of mobile's `getFormattingLocale` (same rule as lib/inviteExpiry.ts). */
function formattingLocale(language: string): string {
  const browserLocale = typeof navigator !== 'undefined' ? navigator.language : '';
  if (browserLocale && browserLocale.startsWith(language)) return browserLocale;
  return language;
}

interface DialogProps {
  context: ShownContext;
  onClose: () => void;
}

function CancelReasonDialog({ context, onClose }: DialogProps): ReactElement {
  const { t, i18n } = useTranslation(['profile', 'common']);
  const commentId = useId();

  const [selected, setSelected] = useState<CancelReason | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [thanks, setThanks] = useState(false);

  // Initial focus lands on the headline (mobile: the header is first focus),
  // not the × button the Modal shell would otherwise pick.
  const headingRef = useRef<HTMLSpanElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // The error renders at the END of the scrolling body, below the comment
  // field — at a normal laptop height that is under the fold, so a failed Send
  // looked like nothing happened. Bring it into view when it appears.
  useEffect(() => {
    if (failed) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [failed]);

  const mountedRef = useRef(true);
  const thanksTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (thanksTimerRef.current) clearTimeout(thanksTimerRef.current);
    };
  }, []);

  // Same shape as mobile ProfileScreen.getRenewalText. UTC: the store's expiry
  // instant, not the viewer's local calendar.
  const formattedDate = new Date(context.expirationDateMs).toLocaleDateString(
    formattingLocale(i18n.language),
    { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }
  );

  const showReassurance = selected === 'auto_charge' && context.entitlementActive;

  /**
   * Not now, ×, Escape, backdrop. Counts as answered-by-declining: the key is
   * written so this cancellation is never asked about again. Ignored while a
   * send is in flight (the shell is also non-dismissible then). After a
   * successful send it only closes (key already written).
   */
  const dismiss = (): void => {
    if (submitting) return;
    if (thanks) {
      if (thanksTimerRef.current) clearTimeout(thanksTimerRef.current);
      onClose();
      return;
    }
    // Fire and forget: the key is hashed asynchronously, and the write never
    // rejects (it swallows its own failures). The dialog closes now; the page
    // load is already marked evaluated, so it cannot re-show meanwhile.
    void markCancelReasonAsked(context.userId, context.unsubscribeDetectedAtMs);
    Analytics.cancelReasonPromptDismissed({
      periodType: context.periodType,
      hadSelection: selected !== null,
      isSandbox: context.isSandbox,
    });
    onClose();
  };

  const send = useGuardedSubmit(async () => {
    if (!selected) return;
    setSubmitting(true);
    setFailed(false);
    const trimmed = comment.trim();
    try {
      await submitCancellationFeedback({
        type: 'cancellation',
        reason: selected,
        ...(trimmed ? { description: trimmed } : {}),
        isSandbox: context.isSandbox,
      });
    } catch {
      // Selection and text survive for a retry, and the key is NOT written: an
      // answer that never landed has not been given.
      if (mountedRef.current) {
        setSubmitting(false);
        setFailed(true);
      }
      return;
    }

    // ONLY AFTER THE 2xx. Awaited (never rejects) so the key is on disk before
    // the thanks state shows.
    await markCancelReasonAsked(context.userId, context.unsubscribeDetectedAtMs);
    Analytics.cancelReasonPromptSubmitted({
      reason: selected,
      hasComment: trimmed.length > 0,
      periodType: context.periodType,
      isSandbox: context.isSandbox,
    });
    if (!mountedRef.current) return;
    setSubmitting(false);
    setThanks(true);
    thanksTimerRef.current = setTimeout(() => {
      if (mountedRef.current) onClose();
    }, THANKS_DURATION_MS);
  });

  // Literal keys at every call site so the translation-key audit can see them.
  const reasonLabel = (reason: CancelReason): string => {
    switch (reason) {
      case 'auto_charge':
        return t('cancelReason.reasons.autoCharge');
      case 'too_expensive':
        return t('cancelReason.reasons.tooExpensive');
      case 'something_broken':
        return t('cancelReason.reasons.somethingBroken');
      case 'missing_feature':
        return t('cancelReason.reasons.missingFeature');
      case 'not_needed':
        return t('cancelReason.reasons.notNeeded');
      case 'other':
        return t('cancelReason.reasons.other');
    }
  };

  const placeholder =
    selected === 'something_broken'
      ? t('cancelReason.placeholderBroken')
      : selected === 'missing_feature'
        ? t('cancelReason.placeholderMissing')
        : t('cancelReason.placeholderDefault');

  const headline = context.entitlementActive
    ? t('cancelReason.headlineActive', { date: formattedDate })
    : t('cancelReason.headlineExpired', { date: formattedDate });

  return (
    <Modal
      // THANKS REPLACES THE HEADLINE (as on mobile). Keeping the date headline
      // over "You keep full access until <date>" said the same date twice.
      title={
        <span ref={headingRef} tabIndex={-1} className="outline-none">
          {thanks ? t('cancelReason.thanks') : headline}
        </span>
      }
      initialFocusRef={headingRef}
      onClose={dismiss}
      closeLabel={t('common:close')}
      size="sm"
      dismissible={!submitting}
      footer={
        thanks ? undefined : (
          <>
            <Button variant="ghost" onClick={dismiss} disabled={submitting}>
              {t('cancelReason.notNow')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void send()}
              disabled={!selected}
              loading={submitting}
            >
              {t('cancelReason.send')}
            </Button>
          </>
        )
      }
    >
      {/*
        PERSISTENT LIVE REGION. It is in the tree from the first render, empty,
        so screen readers are already watching it when the thanks text lands —
        a region inserted together with its content is often not announced.
      */}
      <div role="status" aria-live="polite">
        {thanks ? (
          <>
            {/* Visible as the dialog title; repeated here only for the
                announcement, which a title swap does not produce. */}
            <span className="sr-only">{t('cancelReason.thanks')}</span>
            {showReassurance ? (
              <Text variant="body" className="text-ink-2">
                {t('cancelReason.reassurance', { date: formattedDate })}
              </Text>
            ) : null}
          </>
        ) : null}
      </div>

      {thanks ? null : (
        <>
          <RadioGroup
            label={t('cancelReason.body')}
            value={selected ?? ''}
            disabled={submitting}
            onChange={(value) => {
              const reason = CANCEL_REASONS.find((r) => r === value);
              if (!reason) return;
              setSelected(reason);
              setFailed(false);
            }}
            options={CANCEL_REASONS.map((reason) => ({ value: reason, label: reasonLabel(reason) }))}
          />

          {selected ? (
            <TextArea
              id={commentId}
              label={t('cancelReason.commentLabel')}
              placeholder={placeholder}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={MAX_COMMENT_LENGTH}
              disabled={submitting}
              rows={3}
            />
          ) : null}

          {/* terracotta-deep, never base terracotta as text (contrast). */}
          {failed ? (
            <p ref={errorRef} role="alert" className="m-0 text-sm text-terracotta-deep">
              {t('cancelReason.error')}
            </p>
          ) : null}
        </>
      )}
    </Modal>
  );
}
