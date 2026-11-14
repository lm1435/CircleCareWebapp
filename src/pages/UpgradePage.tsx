import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  CircleButton,
  EmptyState,
  Eyebrow,
  Spinner,
  Text,
  useToast,
} from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { useAccountTimezone } from '@/hooks/useAccountTimezone';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { readBrowserTimezone, webCheckoutVerdict } from '@/lib/checkoutCountry';
import { isUserCancelledError, type WebPlan } from '@/lib/purchases';
import { notePaywallShown } from '@/lib/reviewMoments';
import { trialChargeFrom, trialStartedMessage } from '@/lib/trialCharge';
import { isWebBillingConfigured } from '@/lib/webBillingConfig';
import { legalUrl } from '@/lib/legalLinks';
import { Analytics, type PaywallDismissMethod } from '@/lib/analytics';
import {
  asOnboardingPaywallTrigger,
  asPaywallContext,
  type PaywallContext,
  type UpgradeLocationState,
} from '@/lib/paywallContext';
import { notifyEarnedPaywallAccepted, notifyEarnedPaywallDismissed } from '@/lib/earnedUpsellSession';
import { clearDeferredFirstRun, takeDeferredFirstRun } from '@/lib/onboardingPaywall';

/**
 * Web purchase page (RevenueCat Web Billing). Free users land here from the
 * Upgrade CTA; on a successful purchase the existing RC webhook flips
 * `plan_tier`, and the hook invalidates `subscription-status` + `circles` so the
 * rest of the app reflects premium. Mirrors the mobile paywall's tiers/copy.
 *
 * THE WEB COUNTERPART OF mobile's `PlanSelectionScreen`. It is reached from
 * four contexts (see lib/paywallContext.ts) and, as of the onboarding-paywall
 * port, fires the SAME five paywall events mobile fires, each carrying the same
 * `paywall_context` value. Until then the web companion fired NO paywall
 * analytics at all, so web conversion was invisible and could not be compared
 * with the mobile cohorts that motivated the paywall in the first place.
 */
export default function UpgradePage(): ReactElement {
  const { t, i18n } = useTranslation('upgrade');
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();

  /**
   * The trigger, from the navigation that opened this page. Untrusted input
   * (`history.pushState` is user-reachable), so it is narrowed to the closed
   * enum and anything unrecognised becomes 'general' rather than inventing a
   * cohort in PostHog.
   */
  const paywallContext = asPaywallContext(
    (location.state as UpgradeLocationState | null)?.paywallContext
  );
  const isOnboarding = paywallContext === 'onboarding';

  const { data: status } = useSubscriptionStatus();
  const { data: plans, isLoading, isError } = useWebPlans();
  const purchase = usePurchasePlan();
  // Same-tick double click: `isPending` only flips after React commits.
  const purchaseGuard = useSubmitGuard();
  const manage = useManageSubscription();
  const [purchased, setPurchased] = useState(false);
  /** The exact trial end + first charge, when the purchase started a trial (lib/trialCharge.ts). */
  const [trialNotice, setTrialNotice] = useState<string | null>(null);

  // ── Analytics ────────────────────────────────────────────────────────────
  //
  // Mirrors mobile's PlanSelectionScreen: one view, then an idempotent
  // dismissal recorded however the user leaves.

  useEffect(() => {
    // No store-review ask in the same tab session as a paywall (lib/reviewMoments.ts).
    notePaywallShown();
  }, []);

  /** When the page was put in front of the user: the zero for `seconds_since_view`
   *  and `seconds_visible`. Set on mount, not during render. */
  const viewStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (viewStartRef.current === null) viewStartRef.current = Date.now();
  }, []);
  const secondsSinceView = useCallback((): number => {
    const start = viewStartRef.current;
    return start === null ? 0 : Math.floor((Date.now() - start) / 1000);
  }, []);

  /** "See everything included" state, mirrored up from PlansView for the dismissal. */
  const detailsExpandedRef = useRef(false);
  /** Did the user scroll at all before leaving? (`paywall_dismissed.scrolled`) */
  const scrolledRef = useRef(false);
  useEffect(() => {
    const onScroll = (): void => {
      if (window.scrollY > 0) scrolledRef.current = true;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /**
   * `paywall_shown` (onboarding 1.3.1): the onboarding paywall was put on screen, with the
   * moment that did it. Once per mount (a ref, because StrictMode double-runs effects);
   * `voice_try_used` is false on web (voice is mobile only).
   */
  const paywallTrigger = asOnboardingPaywallTrigger(
    (location.state as UpgradeLocationState | null)?.paywallTrigger
  );
  const paywallShownRef = useRef(false);
  useEffect(() => {
    if (!isOnboarding || paywallShownRef.current) return;
    paywallShownRef.current = true;
    Analytics.paywallShown(paywallTrigger, false);
  }, [isOnboarding, paywallTrigger]);

  /**
   * A completed purchase is not a dismissal. Set BEFORE the navigation that
   * follows it, because the unmount cleanup below runs synchronously with that
   * navigation (mobile keeps `purchasedRef` for the identical reason).
   */
  const purchasedRef = useRef(false);

  /**
   * IDEMPOTENT BY REF, and that is load-bearing. There are several ways out of
   * this page and most of them fire twice: the decline button records and then
   * navigates, and the navigation unmounts the page, which would record again.
   * Double-counted dismissals corrupt the exact rate this event exists to
   * measure.
   */
  /**
   * `plan_selection_viewed`, ONCE. It waits for the page to SETTLE (plans loaded,
   * or a terminal state such as store-only or checkout-unavailable rendered) so
   * `trial_shown` reports what was actually on screen. If the user leaves before
   * that, the dismissal flushes it first, so a view always precedes its dismissal
   * and the denominator still counts every time we put this page in front of
   * someone, as before.
   */
  const viewedRef = useRef(false);
  const viewInfoRef = useRef<{ trialShown: boolean; defaultPlan: PlanKey }>({
    trialShown: false,
    defaultPlan: 'annual',
  });
  const ensureViewed = useCallback((): void => {
    if (viewedRef.current) return;
    viewedRef.current = true;
    Analytics.planSelectionViewed(paywallContext, viewInfoRef.current);
  }, [paywallContext]);

  const dismissalRecordedRef = useRef(false);
  const recordDismissal = useCallback((method: PaywallDismissMethod): void => {
    if (dismissalRecordedRef.current || purchasedRef.current) return;
    dismissalRecordedRef.current = true;
    ensureViewed();
    Analytics.paywallDismissed(paywallContext, {
      method,
      secondsVisible: secondsSinceView(),
      detailsExpanded: detailsExpandedRef.current,
      scrolled: scrolledRef.current,
    });
    // Earned ask only (no-op for every other context): the DURABLE per-trigger
    // dismissal, as mobile's PlanSelectionScreen reports back.
    notifyEarnedPaywallDismissed(paywallContext);
  }, [paywallContext, ensureViewed, secondsSinceView]);

  /**
   * THE ONLY WAY A BROWSER-BACK IS HEARD. `/upgrade` is a route, not a modal:
   * the back button, a bookmark, and the tab's close button all leave without
   * touching any control on this page. Mobile subscribes to `beforeRemove` for
   * the same exit; unmount is the web equivalent.
   *
   * ARMED ON A MACROTASK BOUNDARY, deliberately. React StrictMode (dev only,
   * see main.tsx) double-invokes effects as setup → cleanup → setup within one
   * commit, so an unguarded cleanup would record a dismissal microseconds after
   * mount and — because refs survive that simulated remount — then swallow the
   * REAL dismissal. Refs are preserved, timers are not yet fired: the deferred
   * arm is what separates the simulated unmount from a real one.
   */
  const armedRef = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      armedRef.current = true;
    }, 0);
    return () => {
      window.clearTimeout(timer);
      if (armedRef.current) {
        recordDismissal('back');
        // A browser-Back exit never went through a control, so the parked return target
        // (onboarding only) is dropped here: it must not outlive the paywall it was for.
        if (isOnboarding) clearDeferredFirstRun();
      }
    };
  }, [recordDismissal, isOnboarding]);

  /**
   * WHERE EVERY ONBOARDING EXIT LANDS: TODAY (onboarding 1.3.1; it used to be the first-run
   * wizard, which now runs BEFORE the paywall). The circle comes from the return target
   * parked in sessionStorage by `consumeOnboardingPaywall` right before navigating here
   * (lib/onboardingPaywall.ts); whether the user bought, declined or closed, they land on
   * the circle they just set up.
   *
   * `replace: true` so Back from Today does not walk into the paywall the user just
   * answered. The `/circles` fallback covers a consumed-or-missing record (a second tab,
   * storage blocked). It is never a dead end.
   */
  const goToDeferredFirstRun = useCallback((): void => {
    const pending = takeDeferredFirstRun();
    if (pending) {
      navigate(`/circles/${pending.circleId}`, { replace: true });
    } else {
      navigate('/circles', { replace: true });
    }
  }, [navigate]);

  /** Leave without buying. Onboarding goes to Today; every other context
   *  keeps this page's original destination. `method` is how they left: the
   *  close X and every back link are 'close', the free-plan button 'continue_free'. */
  const handleDecline = useCallback(
    (method: PaywallDismissMethod = 'close'): void => {
      recordDismissal(method);
      if (isOnboarding) goToDeferredFirstRun();
      else navigate('/profile');
    },
    [recordDismissal, isOnboarding, goToDeferredFirstRun, navigate]
  );
  const handleClose = useCallback((): void => handleDecline('close'), [handleDecline]);

  /**
   * The explicit "continue on the free plan" affordance — mobile shows it on
   * the onboarding context only (PlanSelectionScreen.tsx:733-746), and firing
   * `plan_selection_free_selected` immediately before dismissing is mobile's
   * exact sequence, so a deliberate decline stays distinguishable from a
   * bounce while still counting in the dismissal rate.
   */
  const handleContinueFree = useCallback((): void => {
    ensureViewed();
    Analytics.planSelectionFreeSelected(paywallContext);
    handleDecline('continue_free');
  }, [paywallContext, handleDecline, ensureViewed]);

  /** Where the post-purchase "Continue" lands: onboarding goes to Today too. */
  const handlePurchasedContinue = useCallback((): void => {
    if (isOnboarding) goToDeferredFirstRun();
    else navigate('/circles');
  }, [isOnboarding, goToDeferredFirstRun, navigate]);

  /**
   * THE COUNTRY GATE. Web checkout makes us the merchant of record, so it is
   * offered only where that is safe (lib/checkoutCountry.ts has the full
   * reasoning and the single editable allowlist). Everyone else is routed to
   * the app stores, where Apple and Google are the merchant of record.
   *
   * FAILS OPEN — an unknown or unmappable zone transacts. That is the
   * deliberate bias, not an oversight; see `isWebCheckoutAllowed`.
   *
   * NOT GATED ON `useWebPlans`: the offering fetch is harmless, and letting it
   * run keeps the gate a pure render decision.
   *
   * TWO SIGNALS, BOTH REQUIRED: the account's saved zone AND the browser's
   * live one must each land on the allowlist. The account zone is kept in
   * step with the last device that signed in (mobile's `syncDeviceSettings`,
   * the web's `DeviceTimezoneSync`), so on its own it is a recent record
   * rather than a location; the browser zone is live but describes a machine,
   * not an account. Full reasoning — including the deliberate, un-bypassed cost to a
   * US customer buying while abroad — is in lib/checkoutCountry.ts.
   *
   * THREE STATES BEFORE SUBSCRIBE CAN APPEAR, and the page renders something
   * different for each. Nothing is optimistic: the gate FAILS CLOSED, so a
   * zone it has not positively matched never reaches a live Subscribe button.
   *
   *   countryPending    `/users/me` in flight        -> spinner
   *   countryUnresolved either zone unreadable       -> retryable error
   *   storeOnly         both read, one not eligible  -> StoreOnlyCard
   *
   * THE SECOND AND THIRD ARE NOT THE SAME THING and must not be merged. Both
   * mean "not allowed to transact", but only the third is a fact about the
   * user. Sending someone in Denver to the App Store because their request
   * timed out is a bad outcome and, worse, not true.
   */
  const {
    timezone: accountTimezone,
    isPending: countryPending,
    refetch: refetchCountry,
  } = useAccountTimezone();
  // Read once per mount: "where is this browser now", fixed for the life of
  // the paywall so the verdict cannot change under the user mid-session.
  const browserTimezone = useMemo(() => readBrowserTimezone(), []);
  const verdict = webCheckoutVerdict(accountTimezone, browserTimezone);
  const countryUnresolved = !countryPending && verdict === 'unresolved';
  const storeOnly = !countryPending && verdict === 'store-only';

  const isPremium = status?.tier === 'premium';
  // Web billing IS configured but the offering came back empty or errored (bad
  // key, CSP block, RC outage). Degrade to the in-app upgrade path instead of
  // rendering a dead, permanently-disabled Subscribe button.
  const noPlans = isError || !plans || (!plans.monthly && !plans.annual);

  // ── plan_selection_viewed, once the page has SETTLED ───────────────────────
  const billingConfigured = isWebBillingConfigured();
  const showsPlans =
    billingConfigured &&
    !isPremium &&
    !countryPending &&
    !countryUnresolved &&
    !storeOnly &&
    !isLoading &&
    !noPlans;
  /** What the page settled on: the plans, or a terminal state. Loading is not settled. */
  const settled =
    !billingConfigured ||
    isPremium ||
    (!countryPending && (countryUnresolved || storeOnly || !isLoading));
  // The plan PlansView pre-selects (annual; monthly only when there is no annual).
  const defaultPlan = plans?.annual ?? plans?.monthly ?? null;
  viewInfoRef.current = {
    trialShown: showsPlans && trialShownFor(defaultPlan),
    defaultPlan: plans?.annual ? 'annual' : plans?.monthly ? 'monthly' : 'annual',
  };
  useEffect(() => {
    if (settled) ensureViewed();
  }, [settled, ensureViewed]);

  const handleManage = (): void => {
    manage.mutate(undefined, {
      onSuccess: (url) => {
        if (!url) showToast(t('alreadyPremium.manageInApp'), 'info');
      },
      onError: () => showToast(t('alreadyPremium.manageInApp'), 'info'),
    });
  };

  const handleSubscribe = (plan: WebPlan, planKey: PlanKey): void => {
    if (purchase.isPending || !purchaseGuard.claim()) return;
    // PURCHASE STARTED (spec §9): before checkout opens, so a cancelled or failed
    // checkout still counts as a tap. After the guard, so a double click is one tap.
    Analytics.planSelectionCtaTapped({
      plan: planKey,
      paywallContext,
      trialShown: trialShownFor(plan),
      detailsExpanded: detailsExpandedRef.current,
      secondsSinceView: secondsSinceView(),
    });
    notifyEarnedPaywallAccepted(paywallContext);
    purchase.mutate(plan, {
      onSettled: purchaseGuard.release,
      onSuccess: (customerInfo) => {
        // Bought. Recorded BEFORE any state change so the unmount cleanup can
        // never read a stale `false` and log the exit as a dismissal.
        purchasedRef.current = true;
        Analytics.planSelectionSubscribed(planKey, paywallContext);
        // IN ADDITION to `subscribed`, never instead of it — mobile emits both
        // (PlanSelectionScreen.tsx:522-525) so `subscribed` remains the single
        // conversion count and trials are a filterable subset of it.
        //
        // DIVERGES FROM MOBILE in what it can know: mobile gates this on
        // per-user StoreKit trial ELIGIBILITY, web has only the product-level
        // offer RevenueCat returns. A returning subscriber who re-buys an
        // annual plan that advertises a trial is counted as a trial start on
        // web and would not be on mobile. `subscribed` is unaffected.
        if (plan.hasFreeTrial) Analytics.planSelectionTrialStarted(planKey, paywallContext);
        // A TRIAL started: the exact end date and first charge, from the
        // entitlement RevenueCat returned, never from what the page advertised.
        const charge = trialChargeFrom(customerInfo);
        if (charge) {
          Analytics.trialChargeNoticeShown('paywall', charge.store);
          setTrialNotice(trialStartedMessage(t, i18n.language, charge, plan.formattedPrice));
        }
        setPurchased(true);
      },
      onError: (err) => {
        // The user dismissing RevenueCat's checkout is not a failure — but it
        // IS a signal, and mobile records it (PlanSelectionScreen.tsx:513).
        // They stay on the paywall, so a later exit is still a dismissal.
        if (isUserCancelledError(err)) {
          Analytics.planSelectionPurchaseCancelled(planKey, paywallContext);
          return;
        }
        showToast(t('error'), 'error');
      },
    });
  };

  /** Onboarding relabels every "leave" control: "Back to Settings" points at a
   *  page a brand-new user has never seen, and the real destination is the
   *  circle they just created. */
  const declineLabel = isOnboarding ? t('onboarding.notNow') : t('back');

  const unavailable = (
    <Card variant="outlined" padding="lg" className="mx-auto max-w-md text-center">
      {/* This is a terminal, whole-page state (no other heading renders
          alongside it) — the axe route crawl flags `page-has-heading-one`
          without a real `<h1>` here. Variant stays `body` (plain informational
          copy, not a big hero); only the tag moves. */}
      <Text variant="body" as="h1" className="text-ink-2!">
        {t('unavailable')}
      </Text>
      <div className="mt-5 flex justify-center">
        <StoreBadges layout="row" />
      </div>
      <BackLink onClick={handleClose}>{declineLabel}</BackLink>
    </Card>
  );

  return (
    <section
      className={
        showsPlans && !purchased
          ? // The compact paywall starts close to the header on a phone, and its pinned
            // footer supplies its own bottom padding.
            'mx-auto w-full max-w-3xl px-6 pt-4 sm:py-12 md:py-16'
          : 'mx-auto w-full max-w-3xl px-6 py-12 md:py-16'
      }
    >
      {!billingConfigured ? (
        unavailable
      ) : purchased ? (
        <EmptyState
          icon="checkmark-circle"
          tone="coral"
          title={t('success.title')}
          // Terminal, whole-page state — no other heading renders alongside
          // it, so this IS the page's <h1> (spec: page-has-heading-one).
          titleAs="h1"
          description={
            trialNotice ? (
              <>
                {t('success.body')}
                <span data-testid="upgrade-trial-charge" className="mt-3 block">
                  {trialNotice}
                </span>
              </>
            ) : (
              t('success.body')
            )
          }
          actions={
            <Button variant="primary" onClick={handlePurchasedContinue}>
              {t('success.cta')}
            </Button>
          }
        />
      ) : isPremium ? (
        <EmptyState
          icon="checkmark-circle"
          tone="coral"
          title={t('alreadyPremium.title')}
          // Terminal, whole-page state — same reasoning as the success state.
          titleAs="h1"
          description={t('alreadyPremium.body')}
          actions={
            <>
              <Button variant="secondary" disabled={manage.isPending} onClick={handleManage}>
                {t('alreadyPremium.manage')}
              </Button>
              <BackLink onClick={handleClose}>{declineLabel}</BackLink>
            </>
          }
        />
      ) : countryPending ? (
        // Resolving the gate, not the offering — see `countryPending`.
        <div className="flex justify-center py-20">
          <Spinner size={32} />
        </div>
      ) : countryUnresolved ? (
        <CountryUnresolvedCard onRetry={refetchCountry} onBack={handleClose} backLabel={declineLabel} />
      ) : storeOnly ? (
        /* AFTER the premium branch on purpose: the gate is about STARTING a
           subscription, never about servicing one, so a subscriber travelling
           (or living) outside the four countries still reaches Manage.
           BEFORE the offering's own loading/empty branches, so a blocked user
           never waits on — or is shown a failure of — a RevenueCat fetch whose
           result this page will not use. */
        <StoreOnlyCard onBack={handleClose} backLabel={declineLabel} />
      ) : isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size={32} />
        </div>
      ) : noPlans ? (
        unavailable
      ) : (
        <PlansView
          plans={plans}
          pending={purchase.isPending}
          isOnboarding={isOnboarding}
          paywallContext={paywallContext}
          onSubscribe={handleSubscribe}
          onContinueFree={handleContinueFree}
          onClose={handleClose}
          onDetailsToggled={(expanded) => {
            detailsExpandedRef.current = expanded;
          }}
          secondsSinceView={secondsSinceView}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

/**
 * "WE COULD NOT WORK OUT WHERE YOU ARE" — NOT "YOU CANNOT BUY HERE".
 *
 * Reached when `/users/me` failed, or answered with no usable timezone. The
 * gate fails closed, so this user does not get a Subscribe button; but they
 * are overwhelmingly likely to be a US buyer with a flaky connection, and the
 * store-only card would tell them something both discouraging and false. So
 * the honest state: say the account did not load, and offer the read again.
 *
 * Follows the page-level load-failure pattern already used by
 * CirclePickerPage, DocumentsPage and EditCirclePage — a `role="alert"` Card
 * with a title, a hint and a `common:retry` button wired to `refetch`.
 */
function CountryUnresolvedCard({
  onRetry,
  onBack,
  backLabel,
}: {
  onRetry: () => void;
  onBack: () => void;
  backLabel: string;
}): ReactElement {
  const { t } = useTranslation(['upgrade', 'common']);

  return (
    <Card
      variant="outlined"
      padding="lg"
      role="alert"
      className="mx-auto max-w-md text-center"
    >
      <div className="flex flex-col items-center">
        {/* Terminal, whole-page state — this IS the page's <h1>
            (axe: page-has-heading-one), as in every other branch here. */}
        <Text variant="h2" as="h1">
          {t('countryError.title')}
        </Text>
        <Text variant="bodyDense" className="mt-2 text-balance text-ink-2!">
          {t('countryError.body')}
        </Text>
        <Button variant="primary" className="mt-6" onClick={onRetry}>
          {t('common:retry')}
        </Button>
        <BackLink onClick={onBack}>{backLabel}</BackLink>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/**
 * THE APP-STORE ROUTE, rendered INSTEAD OF the paywall — the plan radios and
 * the Subscribe button are not in the tree at all here, not merely disabled.
 * A disabled control is still announced, still a tab stop, and still
 * advertises a checkout that will never open.
 *
 * THE COPY IS A ROUTE, NOT A REJECTION, and it says nothing about regions,
 * countries, availability or tax. Which jurisdictions we can be merchant of
 * record in is our problem; to the caregiver reading this, subscribing in the
 * app is simply how it is done. (It is also true: the app is where the large
 * majority of subscriptions are bought.)
 *
 * DEVICE-AWARE, through `useCoarsePointer` — the pointer media query the
 * pickers already use, never a UA sniff. On a phone the badges deep-link
 * straight to the listing and the copy says "below"; on a laptop "visit the
 * App Store" would be meaningless, so the copy says where the purchase
 * actually happens. Wrong-guess cost is one sentence, and the fine-pointer
 * fallback (jsdom, a prerender) is the safe side.
 *
 * THE SUPPORT LINE IS THE ESCAPE HATCH. Without it a desktop visitor with no
 * smartphone reaches a dead end with no recourse. It is visually secondary to
 * the badges but it is a real link, not a phone number in prose.
 */
function StoreOnlyCard({
  onBack,
  backLabel,
}: {
  onBack: () => void;
  backLabel: string;
}): ReactElement {
  // `help` for the support address only — one canonical copy of it, shared
  // with HelpPage's "Still need help?" card rather than a second literal here.
  const { t } = useTranslation(['upgrade', 'help']);
  const coarsePointer = useCoarsePointer();

  return (
    <Card variant="outlined" padding="lg" className="mx-auto max-w-md text-center">
      <div className="flex flex-col items-center">
        <Eyebrow color="coral" deep>
          {t('eyebrow')}
        </Eyebrow>
        {/* Terminal, whole-page state — no other heading renders alongside it,
            so this IS the page's <h1> (axe: page-has-heading-one). */}
        <Text variant="h2" as="h1" className="mt-3">
          {t('storeOnly.title')}
        </Text>
        <Text variant="bodyDense" className="mt-2 text-balance text-ink-2!">
          {coarsePointer ? t('storeOnly.bodyMobile') : t('storeOnly.bodyDesktop')}
        </Text>

        {/* A named group so the two badges are announced as one choice
            ("Get the CircleCare app") rather than as two loose links. */}
        <div
          role="group"
          aria-label={t('storeOnly.storesLabel')}
          className="mt-5 flex justify-center"
        >
          <StoreBadges layout="row" />
        </div>

        <Text variant="caption" className="mt-6">
          {t('storeOnly.helpPrefix')}{' '}
          <a href={`mailto:${t('help:contact.email')}`} className="underline hover:text-ink">
            {t('storeOnly.helpCta')}
          </a>
          .
        </Text>

        <BackLink onClick={onBack}>{backLabel}</BackLink>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */

/** Mobile's per-context headline keys, collapsed to one i18n group per context.
 *  Onboarding has its own one-sentence headline (`headlineOnboarding`). */
const HEADLINE_KEY = {
  general: 'general',
  capacity: 'capacity',
  invite_cap: 'capacity',
  feature: 'feature',
  earned_meds: 'earnedMeds',
  earned_invite: 'earnedInvite',
  shifts: 'shifts',
} as const satisfies Record<Exclude<PaywallContext, 'onboarding'>, string>;

type PlanKey = 'annual' | 'monthly';

const TRIAL_UNITS = ['day', 'week', 'month', 'year'] as const;
type TrialUnit = (typeof TRIAL_UNITS)[number];
type TrialPeriod = { number: number; unit: string } | null | undefined;

function knownTrialUnit(p: TrialPeriod): TrialUnit | null {
  if (!p || !(p.number > 0)) return null;
  return (TRIAL_UNITS as readonly string[]).includes(p.unit) ? (p.unit as TrialUnit) : null;
}

/**
 * IS TRIAL WORDING ON SCREEN for this plan? Only when the offer has a free trial
 * AND the store told us how long it is.
 *
 * Every trial sentence states the length ("7 days free, then ..."), and a trial
 * sentence without one is the unqualified claim store review and the FTC target.
 * So an offer that says "trial" without a usable length (never seen from
 * RevenueCat Web Billing, but the type allows it) falls back to the plain price
 * and renewal copy: the price and renewal terms are still true, and the store
 * granting a trial we did not advertise costs the buyer nothing. The reverse
 * (advertising a trial that is not there) is the harm, and this rule cannot do it.
 * Mobile follows the same rule with its eligibility tri-state.
 */
export function trialShownFor(plan: WebPlan | null | undefined): boolean {
  return Boolean(plan?.hasFreeTrial && knownTrialUnit(plan.trialPeriod));
}

/** The reason rows on the first view: what people pay for (spec §5, three, no icons). */
const REASONS = ['caregivers', 'shifts', 'circles'] as const;
/** Behind "See everything included", in this order (spec §6). */
const DETAILS = ['voice', 'team', 'exports', 'storage', 'ai'] as const;
type BenefitId = (typeof REASONS)[number] | (typeof DETAILS)[number];

const DETAILS_ID = 'upgrade-details';

/**
 * THE FOOTER: buy button, terms line, free-plan button, legal links.
 *
 * Pinned to the bottom of the screen on a phone-width, normal-height viewport,
 * so the two buttons the page exists for are on the first view (spec §5,
 * P6). `pin-footer:` (globals.css) turns OFF on a short viewport (large browser
 * zoom, landscape): a pinned footer taller than half the screen would cover the
 * price, so there it flows at the end of the content instead (N8). From `sm` up
 * the card fits without pinning.
 */
const FOOTER_CLASS = [
  'mt-6 flex w-full flex-col gap-2 border-t border-line bg-bg pt-3 pb-4',
  'pin-footer:sticky pin-footer:bottom-0 pin-footer:z-10 pin-footer:-mx-6 pin-footer:w-auto pin-footer:px-6',
].join(' ');

interface PlansViewProps {
  plans: { monthly: WebPlan | null; annual: WebPlan | null } | undefined;
  pending: boolean;
  /** The once-ever post-first-circle ask: its own headline and the free-plan button. */
  isOnboarding: boolean;
  paywallContext: PaywallContext;
  /** `planKey` is passed alongside the plan because analytics must send
   *  mobile's `'monthly' | 'annual'`, not RevenueCat's `$rc_*` identifiers. */
  onSubscribe: (plan: WebPlan, planKey: PlanKey) => void;
  onContinueFree: () => void;
  /** The close X: the exit in every context (onboarding also has the free button). */
  onClose: () => void;
  /** Mirrors "See everything included" up to the page for `paywall_dismissed`. */
  onDetailsToggled: (expanded: boolean) => void;
  secondsSinceView: () => number;
}

/**
 * THE COMPACT PAYWALL (1.4.2, docs/plans/paywall-redesign-1-4-2.md, owner chose
 * version 1). Web counterpart of mobile's PlanSelectionScreen, same order and
 * wording: eyebrow with a small decorative logo, one headline, the plan choice
 * with the billed price as the largest text, three text-only reasons, "See
 * everything included" (expands in place), and a footer with the buy button,
 * the renewal terms and the legal links. Moss appears once: the buy button.
 *
 * Plan control stays two radio cards on the web (mobile has a segmented toggle).
 * NO RESTORE LINK ON THE WEB: signing in IS the restore here (the subscription
 * belongs to the account, and `alreadyPremium` covers a subscriber who lands on
 * this page), so a Restore control would be a dead link.
 */
function PlansView({
  plans,
  pending,
  isOnboarding,
  paywallContext,
  onSubscribe,
  onContinueFree,
  onClose,
  onDetailsToggled,
  secondsSinceView,
}: PlansViewProps): ReactElement {
  const { t, i18n } = useTranslation(['upgrade', 'common']);

  // Literal keys (the static key audit cannot resolve a template string).
  const contextHeadlines = {
    general: `${t('headline.general.lead')} ${t('headline.general.accent')}`,
    capacity: `${t('headline.capacity.lead')} ${t('headline.capacity.accent')}`,
    feature: `${t('headline.feature.lead')} ${t('headline.feature.accent')}`,
    earnedMeds: `${t('headline.earnedMeds.lead')} ${t('headline.earnedMeds.accent')}`,
    earnedInvite: `${t('headline.earnedInvite.lead')} ${t('headline.earnedInvite.accent')}`,
    shifts: `${t('headline.shifts.lead')} ${t('headline.shifts.accent')}`,
  };
  const headline =
    paywallContext === 'onboarding'
      ? t('headlineOnboarding')
      : contextHeadlines[HEADLINE_KEY[paywallContext]];

  const benefits: Record<BenefitId, { title: string; sub: string }> = {
    caregivers: { title: t('benefits.caregivers.title'), sub: t('benefits.caregivers.sub') },
    shifts: { title: t('benefits.shifts.title'), sub: t('benefits.shifts.sub') },
    circles: { title: t('benefits.circles.title'), sub: t('benefits.circles.sub') },
    voice: { title: t('benefits.voice.title'), sub: t('benefits.voice.sub') },
    team: { title: t('benefits.team.title'), sub: t('benefits.team.sub') },
    exports: { title: t('benefits.exports.title'), sub: t('benefits.exports.sub') },
    storage: { title: t('benefits.storage.title'), sub: t('benefits.storage.sub') },
    ai: { title: t('benefits.ai.title'), sub: t('benefits.ai.sub') },
  };

  const monthly = plans?.monthly ?? null;
  const annual = plans?.annual ?? null;

  /**
   * The store's trial length in words. `trialPeriod` = "7-day" (the EN adjective,
   * for the buy button; other languages' noun phrase), `trialLength` = "7 days"
   * (the billing and terms lines). ONE dynamic call site for both families.
   */
  const trialWords = (family: 'trialPeriod' | 'trialLength', p: TrialPeriod): string => {
    const unit = knownTrialUnit(p);
    return unit && p ? t(`${family}.${unit}`, { count: p.number }) : '';
  };
  const trialPeriodLabel = (p: TrialPeriod): string => trialWords('trialPeriod', p);
  const trialLengthLabel = (p: TrialPeriod): string => trialWords('trialLength', p);

  // Honest, data-driven savings + per-month equivalent from the raw amounts.
  const savePercent =
    monthly && annual && annual.priceMicros < monthly.priceMicros * 12
      ? Math.round((1 - annual.priceMicros / (monthly.priceMicros * 12)) * 100)
      : null;
  const perMonthEquivalent = annual ? formatMoney(annual.priceMicros / 12, annual.currency) : null;

  /** Line 2 of a plan card (spec §5 row 5). Null = say nothing rather than something false. */
  const billingLine = (plan: WebPlan, key: PlanKey): string | null => {
    const trial = trialShownFor(plan);
    if (key === 'annual') {
      return trial
        ? t('plans.billingAnnualTrial', { length: trialLengthLabel(plan.trialPeriod) })
        : t('plans.billingAnnual');
    }
    if (trial) return t('plans.billingMonthlyTrial', { length: trialLengthLabel(plan.trialPeriod) });
    // "No free trial." would be false for an offer that has one we could not size.
    return plan.hasFreeTrial ? null : t('plans.billingMonthly');
  };

  /** Row 9: price, length of any trial, and that it renews until cancelled. */
  const termsLine = (plan: WebPlan, key: PlanKey): string => {
    const trial = trialShownFor(plan);
    const price = plan.formattedPrice;
    const length = trialLengthLabel(plan.trialPeriod);
    if (key === 'annual') {
      return trial
        ? t('plans.termsAnnualTrial', { length, price })
        : t('plans.termsAnnual', { price });
    }
    return trial ? t('plans.termsMonthlyTrial', { length, price }) : t('plans.termsMonthly', { price });
  };

  // Selection model: pick a plan, then one shared CTA confirms it. Default to
  // annual (best value); fall back to whichever plan actually exists.
  const [selected, setSelected] = useState<PlanKey>('annual');
  const selectedPlan = (selected === 'annual' ? annual : monthly) ?? annual ?? monthly;
  // Derived from the RESOLVED plan, not from `selected`: the line above falls
  // back to the other package when the selected one is missing, and the
  // analytics `plan` property must name what was actually bought.
  const selectedKey: PlanKey = selectedPlan === annual ? 'annual' : 'monthly';
  const ctaLabel = selectedPlan
    ? trialShownFor(selectedPlan)
      ? t('startTrialWithDuration', { period: trialPeriodLabel(selectedPlan.trialPeriod) })
      : selectedKey === 'annual'
        ? t('subscribeAnnual', { price: selectedPlan.formattedPrice })
        : t('subscribeMonthly', { price: selectedPlan.formattedPrice })
    : '';
  // No price, no purchase (N9): a plan without a store price never reaches checkout.
  const canBuy = Boolean(selectedPlan?.formattedPrice);

  const choose = useCallback(
    (key: PlanKey) => {
      setSelected((prev) => {
        if (prev !== key) Analytics.planSelectionPlanChanged(key, paywallContext);
        return key;
      });
    },
    [paywallContext]
  );

  const [expanded, setExpanded] = useState(false);
  const toggleDetails = (): void => {
    const next = !expanded;
    setExpanded(next);
    onDetailsToggled(next);
    Analytics.planSelectionDetailsToggled(next, paywallContext, secondsSinceView());
  };

  // ── Roving tabindex (WAI-ARIA APG radiogroup) ─────────────────────────────
  // Exactly one Card is a tab stop (`tabIndex={selected ? 0 : -1}`, set at each
  // PlanOption below); the arrow keys move BOTH the selection and focus, which
  // is why this lives on the radiogroup container rather than each card.
  const radioGroupRef = useRef<HTMLDivElement>(null);
  // DOM order of the plans actually rendered — a plan that doesn't exist is
  // never a stop, so Home/End/arrow wraparound only ever land on a real card.
  const planOrder: PlanKey[] = [annual ? 'annual' : null, monthly ? 'monthly' : null].filter(
    (key): key is PlanKey => key !== null
  );

  const focusPlan = useCallback((key: PlanKey) => {
    radioGroupRef.current?.querySelector<HTMLElement>(`[data-plan-key="${key}"]`)?.focus();
  }, []);

  const handleRadioGroupKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (planOrder.length < 2) return;
      const currentIndex = planOrder.indexOf(selectedKey);
      let nextIndex: number | null = null;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        nextIndex = (currentIndex + 1) % planOrder.length;
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        nextIndex = (currentIndex - 1 + planOrder.length) % planOrder.length;
      } else if (event.key === 'Home') {
        nextIndex = 0;
      } else if (event.key === 'End') {
        nextIndex = planOrder.length - 1;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      const nextKey = planOrder[nextIndex];
      choose(nextKey);
      focusPlan(nextKey);
    },
    [planOrder, selectedKey, focusPlan, choose]
  );

  const reasonRow = (id: BenefitId): ReactElement => (
    <li key={id} data-benefit={id} className="border-b border-line py-3">
      <span className="block text-md font-semibold text-ink">{benefits[id].title}</span>
      <span className="block text-sm text-ink-2">{benefits[id].sub}</span>
    </li>
  );

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col text-left">
      {/* Eyebrow row: the 22px logo sits INLINE before the eyebrow, in the same
          row as the close X, so it adds no height (owner decision 2026-11-13).
          Decorative: alt="" + aria-hidden, so "CircleCare" is not read twice. */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <img
            src="/logo-mark.png"
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
            data-paywall-logo=""
            className="cc-logo-mark-light h-[22px] w-[22px] shrink-0 rounded-[6px]"
          />
          <img
            src="/logo-mark-dark.png"
            alt=""
            aria-hidden="true"
            width={22}
            height={22}
            data-paywall-logo=""
            className="cc-logo-mark-dark h-[22px] w-[22px] shrink-0 rounded-[6px]"
          />
          <Eyebrow className="font-semibold">{t('eyebrow')}</Eyebrow>
        </div>
        <CircleButton
          name="close-outline"
          label={t('common:close')}
          shadow={false}
          onClick={onClose}
          data-testid="upgrade-close"
        />
      </div>

      {/* ONE <h1>, one colour, the page-title style. Onboarding has its own
          sentence; every other context keeps its own headline (spec §5). */}
      <Text variant="pageTitle" as="h1" className="mt-2">
        {headline}
      </Text>

      {/* Real ARIA radios via the Card primitive (role="radio" + aria-checked),
          not native inputs — the whole card is the hit target and one Card per
          option is the only focusable control. Roving tabindex per the WAI-ARIA
          APG radiogroup pattern. */}
      <div
        ref={radioGroupRef}
        role="radiogroup"
        aria-label={t('choosePlan')}
        onKeyDown={handleRadioGroupKeyDown}
        className="mt-5 grid w-full grid-cols-1 items-stretch gap-3 sm:grid-cols-2"
      >
        {annual && (
          <PlanOption
            planKey="annual"
            selected={selectedPlan === annual}
            onSelect={() => choose('annual')}
            label={t('plans.annual')}
            price={annual.formattedPrice}
            currency={annual.currency}
            period={t('plans.perYear')}
            badge={savePercent ? t('plans.savePercent', { percent: savePercent }) : null}
            billing={billingLine(annual, 'annual')}
            perMonth={perMonthEquivalent ? t('plans.perMonthBilled', { price: perMonthEquivalent }) : null}
          />
        )}
        {monthly && (
          <PlanOption
            planKey="monthly"
            selected={selectedPlan === monthly}
            onSelect={() => choose('monthly')}
            label={t('plans.monthly')}
            price={monthly.formattedPrice}
            currency={monthly.currency}
            period={t('plans.perMonth')}
            badge={null}
            billing={billingLine(monthly, 'monthly')}
            perMonth={null}
          />
        )}
      </div>

      {/* Three reasons, text only: semibold title, one muted line, hairline between. */}
      <ul data-reasons="" className="m-0 mt-4 list-none p-0">
        {REASONS.map(reasonRow)}
      </ul>

      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={DETAILS_ID}
        onClick={toggleDetails}
        className="mt-1 inline-flex min-h-11 items-center self-start text-md font-semibold text-ink underline underline-offset-4 hover:text-ink-2"
      >
        {expanded ? t('showLess') : t('seeEverything')}
      </button>
      {/* Expands IN PLACE, below the reasons. The wrapper always exists so
          `aria-controls` never points at nothing. */}
      <div id={DETAILS_ID}>
        {expanded && (
          <ul data-details="" className="m-0 list-none p-0">
            {DETAILS.map(reasonRow)}
          </ul>
        )}
      </div>

      <div data-testid="upgrade-footer" className={FOOTER_CLASS}>
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={pending}
          disabled={!canBuy}
          onClick={() => selectedPlan && canBuy && onSubscribe(selectedPlan, selectedKey)}
        >
          {ctaLabel}
        </Button>

        {/* Row 9: ALWAYS on the first view, never behind the details link
            (Google: terms visible without an extra action). */}
        {selectedPlan && (
          <Text variant="caption" data-testid="upgrade-terms" className="text-center">
            {termsLine(selectedPlan, selectedKey)}
          </Text>
        )}

        {/* CONTINUE FREE — onboarding context only, exactly as mobile. THE USER
            MUST BE ABLE TO DECLINE: this is a soft paywall shown to someone who
            has owned a care circle for a few seconds. In the pinned footer, so it
            is on the first view. */}
        {isOnboarding && (
          <Button variant="ghost" fullWidth className="flex-col gap-0.5 py-2" onClick={onContinueFree}>
            <span className="font-semibold text-ink">{t('onboarding.continueFree')}</span>
            <span className="text-sm font-normal text-ink-2">{t('onboarding.continueFreeSub')}</span>
          </Button>
        )}

        <div className="flex items-center justify-center gap-3 text-sm">
          <a
            href={legalUrl('terms', i18n.language)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => Analytics.planSelectionLegalOpened('terms')}
            className="inline-flex min-h-11 items-center text-ink-2 underline hover:text-ink"
          >
            {t('termsLink')}
          </a>
          <span aria-hidden="true" className="text-ink-3">
            ·
          </span>
          <a
            href={legalUrl('privacy', i18n.language)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => Analytics.planSelectionLegalOpened('privacy')}
            className="inline-flex min-h-11 items-center text-ink-2 underline hover:text-ink"
          >
            {t('privacyLink')}
          </a>
        </div>
      </div>

      {/* Web-only facts (spec §6): who takes the payment, and the app path. */}
      <Text variant="caption" className="mt-2 text-center">
        {t('securedByStripe')}
      </Text>
      <div className="mt-6 w-full border-t border-line pt-6 pb-8 text-center">
        <Text variant="caption" className="mb-3">
          {t('orUseApp')}
        </Text>
        <div className="flex justify-center">
          <StoreBadges layout="row" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface PlanOptionProps {
  /** DOM anchor for the radiogroup's roving-tabindex focus management. */
  planKey: PlanKey;
  selected: boolean;
  onSelect: () => void;
  label: string;
  price: string;
  /** ISO 4217 code shown beside the price. Every market we sell to on the web
   *  (US/CA/AU/NZ) renders a bare `$` in its own locale, so the symbol alone
   *  never says WHICH dollar. */
  currency: string;
  period: string;
  badge: string | null;
  /** Line 2: billing cadence and any trial ("7 days free, then billed yearly"). */
  billing: string | null;
  /** Line 3, annual only, smaller: the per-month equivalent. */
  perMonth: string | null;
}

/**
 * A real ARIA radio (role="radio" + aria-checked) rendered on the `Card`
 * primitive's own `onPress` button. The whole card is the hit target;
 * `RadioDot` is a purely decorative echo of the checked state.
 *
 * SELECTION IS NEUTRAL (one accent: moss is the buy button only). The selected
 * card recolours its 1px border to the selected-fill ink and adds a 1px ring
 * (box-shadow, no layout), so both states share one border width and the
 * content never moves.
 *
 * The accessible name carries EVERY line of the card: `aria-label` on a button
 * replaces its contents, so a name of just "Annual, $59.99" would hide the
 * trial terms and the per-month price from a screen reader.
 *
 * THE BILLED AMOUNT IS THE LARGEST PRICE (Apple 3.1.2, Google): page-title size;
 * the per-month equivalent is caption size.
 */
function PlanOption({
  planKey,
  selected,
  onSelect,
  label,
  price,
  currency,
  period,
  badge,
  billing,
  perMonth,
}: PlanOptionProps): ReactElement {
  const name = [`${label}, ${price} ${currency} ${period}`, billing, perMonth, badge]
    .filter(Boolean)
    .join(', ');
  return (
    <Card
      variant="outlined"
      padding="md"
      onPress={onSelect}
      role="radio"
      aria-checked={selected}
      aria-label={name}
      data-plan-key={planKey}
      tabIndex={selected ? 0 : -1}
      className={[
        'relative flex flex-col text-left transition-shadow',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-coral has-[:focus-visible]:ring-offset-2',
        // `!` on the colours: Card's own `border-line-2` is emitted LATER in the
        // compiled stylesheet, so a plain override loses the cascade.
        selected
          ? 'border-selected-fill! ring-1 ring-selected-fill'
          : 'border-line! hover:shadow-md',
      ].join(' ')}
    >
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <RadioDot selected={selected} />
          <Text variant="h3" as="span">
            {label}
          </Text>
        </span>
        {badge && (
          <Badge variant="default" size="sm">
            {badge}
          </Badge>
        )}
      </div>

      <p className="m-0 mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <Text variant="pageTitle" as="span" data-price="">
          {price}
        </Text>
        <Text variant="caption" as="span">
          {currency}
        </Text>
        <Text variant="caption" as="span">
          {period}
        </Text>
      </p>
      {billing && (
        <span data-billing="" className="block text-sm font-semibold text-ink">
          {billing}
        </span>
      )}
      {perMonth && (
        <Text variant="caption" as="span" data-per-month="" className="block">
          {perMonth}
        </Text>
      )}
    </Card>
  );
}

function RadioDot({ selected }: { selected: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={[
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
        selected ? 'border-selected-fill bg-selected-fill' : 'border-ink/30',
      ].join(' ')}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-on-selected" />}
    </span>
  );
}

/* ----------------------------- bits ----------------------------- */

function BackLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-8 inline-flex min-h-11 items-center text-sm text-ink-3 underline hover:text-ink"
    >
      {children}
    </button>
  );
}

/**
 * DELIBERATE: the locale is `undefined` (the browser/payment locale), NOT
 * `i18n.language`.
 *
 * This helper only ever renders the DERIVED per-month equivalent, and it is
 * shown directly beneath `plan.formattedPrice` — a string the RevenueCat Web
 * SDK formats itself, in the browser locale, which we cannot re-format or
 * re-locale. Pinning this one figure to the UI language would put two
 * differently-formatted prices ("$59.99" and "5,00 US$") inside the same card.
 * Currency notation is a payment-market convention, not a UI-language one, so
 * matching the store's own formatting is the correct behaviour here.
 */
function formatMoney(amountMicros: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    amountMicros / 1_000_000
  );
}
