import {
  useCallback,
  useEffect,
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
  EmptyState,
  Eyebrow,
  Icon,
  Spinner,
  Text,
  useToast,
} from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { isUserCancelledError, type WebPlan } from '@/lib/purchases';
import { isWebBillingConfigured } from '@/lib/webBillingConfig';
import { legalUrl } from '@/lib/legalLinks';
import { Analytics } from '@/lib/analytics';
import { asPaywallContext, type UpgradeLocationState } from '@/lib/paywallContext';
import { firstRunNavigationState, takeDeferredFirstRun } from '@/lib/onboardingPaywall';

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
  const { t } = useTranslation('upgrade');
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
  const manage = useManageSubscription();
  const [purchased, setPurchased] = useState(false);

  // ── Analytics ────────────────────────────────────────────────────────────
  //
  // Mirrors PlanSelectionScreen.tsx:310-318 (viewed on mount) and :432-454
  // (an idempotent dismissal recorded however the user leaves).

  /** Fired once per view, unconditionally — including the degraded
   *  "checkout unavailable" render, so the denominator counts every time we
   *  put this page in front of someone, exactly as mobile does. */
  useEffect(() => {
    Analytics.planSelectionViewed(paywallContext);
  }, [paywallContext]);

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
  const dismissalRecordedRef = useRef(false);
  const recordDismissal = useCallback((): void => {
    if (dismissalRecordedRef.current || purchasedRef.current) return;
    dismissalRecordedRef.current = true;
    Analytics.paywallDismissed(paywallContext);
  }, [paywallContext]);

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
      if (armedRef.current) recordDismissal();
    };
  }, [recordDismissal]);

  /**
   * HOW THE DEFERRED FIRST-RUN WIZARD SURVIVES THE ROUTE CHANGE.
   *
   * Mobile defers the wizard in a ref and replays it on the create screen's
   * next `focus`. Web cannot: `/upgrade` is a full route, the create modal is
   * long unmounted, and its component state is gone. The record therefore
   * lives in sessionStorage (lib/onboardingPaywall.ts) and is CONSUMED here,
   * on the way out — every exit from the onboarding paywall lands on the new
   * circle with the wizard open, whether the user bought, declined, or closed.
   *
   * `replace: true` so Back from the circle does not walk into the paywall the
   * user just answered — mobile resets its stack for the same reason.
   *
   * The `/circles` fallback covers a consumed-or-missing record (a second tab,
   * storage blocked). It is never a dead end.
   */
  const goToDeferredFirstRun = useCallback((): void => {
    const pending = takeDeferredFirstRun();
    if (pending) {
      navigate(`/circles/${pending.circleId}`, {
        replace: true,
        state: firstRunNavigationState(pending.recipientName),
      });
    } else {
      navigate('/circles', { replace: true });
    }
  }, [navigate]);

  /** Leave without buying. Onboarding goes to the wizard; every other context
   *  keeps this page's original destination. */
  const handleDecline = useCallback((): void => {
    recordDismissal();
    if (isOnboarding) goToDeferredFirstRun();
    else navigate('/profile');
  }, [recordDismissal, isOnboarding, goToDeferredFirstRun, navigate]);

  /**
   * The explicit "continue on the free plan" affordance — mobile shows it on
   * the onboarding context only (PlanSelectionScreen.tsx:733-746), and firing
   * `plan_selection_free_selected` immediately before dismissing is mobile's
   * exact sequence, so a deliberate decline stays distinguishable from a
   * bounce while still counting in the dismissal rate.
   */
  const handleContinueFree = useCallback((): void => {
    Analytics.planSelectionFreeSelected(paywallContext);
    handleDecline();
  }, [paywallContext, handleDecline]);

  /** Where the post-purchase "Continue" lands. A purchase does not cancel the
   *  wizard — mobile replays the deferred wizard after a purchase too. */
  const handlePurchasedContinue = useCallback((): void => {
    if (isOnboarding) goToDeferredFirstRun();
    else navigate('/circles');
  }, [isOnboarding, goToDeferredFirstRun, navigate]);

  const isPremium = status?.tier === 'premium';
  // Web billing IS configured but the offering came back empty or errored (bad
  // key, CSP block, RC outage). Degrade to the in-app upgrade path instead of
  // rendering a dead, permanently-disabled Subscribe button.
  const noPlans = isError || !plans || (!plans.monthly && !plans.annual);

  const handleManage = (): void => {
    manage.mutate(undefined, {
      onSuccess: (url) => {
        if (!url) showToast(t('alreadyPremium.manageInApp'), 'info');
      },
      onError: () => showToast(t('alreadyPremium.manageInApp'), 'info'),
    });
  };

  const handleSubscribe = (plan: WebPlan, planKey: PlanKey): void => {
    purchase.mutate(plan, {
      onSuccess: () => {
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

  /** Onboarding relabels every "leave" control: "Back to profile" points at a
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
      <BackLink onClick={handleDecline}>{declineLabel}</BackLink>
    </Card>
  );

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-12 md:py-16">
      {!isWebBillingConfigured() ? (
        unavailable
      ) : purchased ? (
        <EmptyState
          icon="checkmark-circle"
          tone="coral"
          title={t('success.title')}
          // Terminal, whole-page state — no other heading renders alongside
          // it, so this IS the page's <h1> (spec: page-has-heading-one).
          titleAs="h1"
          description={t('success.body')}
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
              <BackLink onClick={handleDecline}>{declineLabel}</BackLink>
            </>
          }
        />
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
          onSubscribe={handleSubscribe}
          onContinueFree={handleContinueFree}
          onBack={handleDecline}
          backLabel={declineLabel}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

interface PlansViewProps {
  plans: { monthly: WebPlan | null; annual: WebPlan | null } | undefined;
  pending: boolean;
  /** The once-ever post-first-circle ask. Adds the explicit free-plan
   *  affordance and swaps in mobile's onboarding headline. */
  isOnboarding: boolean;
  /** `planKey` is passed alongside the plan because analytics must send
   *  mobile's `'monthly' | 'annual'`, not RevenueCat's `$rc_*` identifiers. */
  onSubscribe: (plan: WebPlan, planKey: PlanKey) => void;
  onContinueFree: () => void;
  onBack: () => void;
  backLabel: string;
}

function PlansView({
  plans,
  pending,
  isOnboarding,
  onSubscribe,
  onContinueFree,
  onBack,
  backLabel,
}: PlansViewProps): ReactElement {
  const { t, i18n } = useTranslation('upgrade');

  const monthly = plans?.monthly ?? null;
  const annual = plans?.annual ?? null;
  const anyTrial = Boolean(monthly?.hasFreeTrial || annual?.hasFreeTrial);
  // Trial DURATION from the store's own offer, so the paywall never advertises
  // a length the store isn't offering (and never omits the length it is).
  const formatTrialPeriod = (p: { number: number; unit: string } | null): string | null => {
    if (!p || p.number <= 0) return null;
    const key = ['day', 'week', 'month', 'year'].includes(p.unit) ? p.unit : null;
    return key ? t(`trialPeriod.${key}`, { count: p.number }) : null;
  };
  const trialPeriodLabel =
    formatTrialPeriod(annual?.trialPeriod ?? null) ?? formatTrialPeriod(monthly?.trialPeriod ?? null);

  // Honest, data-driven savings + per-month equivalent from the raw amounts.
  const savePercent =
    monthly && annual && annual.priceMicros < monthly.priceMicros * 12
      ? Math.round((1 - annual.priceMicros / (monthly.priceMicros * 12)) * 100)
      : null;
  const perMonthEquivalent = annual ? formatMoney(annual.priceMicros / 12, annual.currency) : null;

  // Selection model: pick a plan, then one shared CTA confirms it. Default to
  // annual (best value); fall back to whichever plan actually exists.
  const [selected, setSelected] = useState<PlanKey>('annual');
  const selectedPlan = (selected === 'annual' ? annual : monthly) ?? annual ?? monthly;
  // Derived from the RESOLVED plan, not from `selected`: the line above falls
  // back to the other package when the selected one is missing, and the
  // analytics `plan` property must name what was actually bought.
  const selectedKey: PlanKey = selectedPlan === annual ? 'annual' : 'monthly';
  const cta = selectedPlan?.hasFreeTrial ? t('startTrial') : t('subscribe');

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
      setSelected(nextKey);
      focusPlan(nextKey);
    },
    [planOrder, selectedKey, focusPlan]
  );

  return (
    <div className="flex flex-col items-center text-center">
      <Eyebrow color="coral" deep>
        {t('eyebrow')}
      </Eyebrow>
      {/* Mobile's onboarding headline/subtitle verbatim (planSelection.headline
          + headlineAccent, planSelection.subtitle) — the same words a mobile
          user sees at the same moment. Other contexts keep the generic copy. */}
      <Text variant="editorialTitle" as="h1" className="mt-5">
        {isOnboarding ? t('onboarding.title') : t('title')}
      </Text>
      {/* text-balance: EN desktop otherwise orphaned "of." on its own line. */}
      <Text variant="bodyDense" className="mt-3 max-w-xl text-balance text-ink-2!">
        {isOnboarding ? t('onboarding.subtitle') : t('subtitle')}
      </Text>
      {anyTrial && (
        // Moss, not coral: coral-deep on coral-soft reads as an alert, and this
        // line is reassurance ("nothing due today").
        <Badge variant="primary" wrap className="mt-4">
          {trialPeriodLabel ? t('trialHookWithDuration', { period: trialPeriodLabel }) : t('trialHook')}
        </Badge>
      )}

      {/* What Premium ADDS -- the same four benefits (title + subline) mobile's
          paywall lists (planSelection.feature*Title/Sub). Literal keys so the
          static key audit resolves each one. */}
      <ul
        data-benefits=""
        className="mx-auto mt-8 grid w-full max-w-2xl list-none grid-cols-1 gap-x-6 gap-y-3 p-0 text-left sm:grid-cols-2"
      >
        {[
          { id: 'circles', title: t('benefits.circles.title'), sub: t('benefits.circles.sub') },
          {
            id: 'caregivers',
            title: t('benefits.caregivers.title'),
            sub: t('benefits.caregivers.sub'),
          },
          { id: 'ai', title: t('benefits.ai.title'), sub: t('benefits.ai.sub') },
          { id: 'exports', title: t('benefits.exports.title'), sub: t('benefits.exports.sub') },
        ].map((benefit) => (
          <li key={benefit.id} className="flex items-start gap-2 text-sm">
            <Icon name="checkmark" size="inline" className="mt-0.5 shrink-0 text-moss" />
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-ink">{benefit.title}</span>
              <span className="text-ink-2">{benefit.sub}</span>
            </span>
          </li>
        ))}
      </ul>

      {/* Real ARIA radios via the Card primitive (role="radio" + aria-checked),
          not native inputs — the whole card is the hit target and one Card per
          option is the only focusable control. Roving tabindex: exactly one
          card is ever a tab stop, and ArrowLeft/Right/Up/Down (plus Home/End)
          move both the selection and focus, per the WAI-ARIA APG radiogroup
          pattern (mirrors SegmentedControl.tsx's roving-tabindex approach). */}
      <div
        ref={radioGroupRef}
        role="radiogroup"
        aria-label={t('choosePlan')}
        onKeyDown={handleRadioGroupKeyDown}
        className="mt-10 grid w-full max-w-2xl grid-cols-1 items-stretch gap-5 sm:grid-cols-2"
      >
        {annual && (
          <PlanOption
            planKey="annual"
            selected={selectedPlan === annual}
            onSelect={() => setSelected('annual')}
            label={t('plans.annual')}
            price={annual.formattedPrice}
            period={t('plans.perYear')}
            badge={savePercent ? t('plans.savePercent', { percent: savePercent }) : t('plans.bestValue')}
            subline={perMonthEquivalent ? t('plans.perMonthBilled', { price: perMonthEquivalent }) : null}
            feature={
              annual.hasFreeTrial
                ? {
                    text: formatTrialPeriod(annual.trialPeriod)
                      ? t('plans.trialWithDuration', { period: formatTrialPeriod(annual.trialPeriod) })
                      : t('plans.trialIncluded'),
                    tone: 'brand',
                  }
                : null
            }
          />
        )}
        {monthly && (
          <PlanOption
            planKey="monthly"
            selected={selectedPlan === monthly}
            onSelect={() => setSelected('monthly')}
            label={t('plans.monthly')}
            price={monthly.formattedPrice}
            period={t('plans.perMonth')}
            subline={t('plans.billedMonthly')}
            feature={
              monthly.hasFreeTrial
                ? {
                    text: formatTrialPeriod(monthly.trialPeriod)
                      ? t('plans.trialWithDuration', { period: formatTrialPeriod(monthly.trialPeriod) })
                      : t('plans.trialIncluded'),
                    tone: 'brand',
                  }
                : { text: t('plans.monthlyPerk'), tone: 'muted' }
            }
          />
        )}
      </div>

      {/* Free-plan baseline so "unlimited" claims have a reference point. */}
      <Text variant="caption" className="mt-3">
        {t('freeBaseline')}
      </Text>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        className="mt-8 sm:w-auto sm:min-w-[18rem]"
        loading={pending}
        disabled={!selectedPlan}
        onClick={() => selectedPlan && onSubscribe(selectedPlan, selectedKey)}
      >
        {cta}
      </Button>

      <Text variant="caption" className="mt-4">
        {t('cancelAnytime')} {t('securedByStripe')}
      </Text>

      {/* Auto-renewal disclosure and legal links must appear before payment
          details are taken (FTC negative-option rule). This checkout entry
          point previously carried neither. */}
      <Text variant="caption" className="mt-2 max-w-md">
        {t('autoRenewNotice')}
      </Text>

      <Text variant="caption" className="mt-2 max-w-md">
        {t('legalPrefix')}{' '}
        <a
          href={legalUrl('terms', i18n.language)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {t('termsLink')}
        </a>{' '}
        {t('legalJoin')}{' '}
        <a
          href={legalUrl('privacy', i18n.language)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {t('privacyLink')}
        </a>
        .
      </Text>

      {/* CONTINUE FREE — onboarding context only, exactly as mobile
          (PlanSelectionScreen.tsx:733-746). THE USER MUST BE ABLE TO DECLINE:
          this is a soft paywall shown to someone who has owned a care circle
          for four seconds, and the next thing they see is the setup wizard
          either way. Do not remove it or hide it behind the fold. */}
      {isOnboarding && (
        <Button
          variant="ghost"
          fullWidth
          className="mt-6 max-w-md flex-col gap-1 py-4"
          onClick={onContinueFree}
        >
          <span className="font-semibold text-ink">{t('onboarding.continueFree')}</span>
          <span className="text-sm text-ink-3">{t('onboarding.continueFreeSub')}</span>
        </Button>
      )}

      {/* The mobile path stays available alongside web checkout. */}
      <div className="mt-8 w-full max-w-md border-t border-line pt-6">
        <Text variant="caption" className="mb-3">
          {t('orUseApp')}
        </Text>
        <div className="flex justify-center">
          <StoreBadges layout="row" />
        </div>
      </div>

      <BackLink onClick={onBack}>{backLabel}</BackLink>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type PlanKey = 'annual' | 'monthly';

interface PlanOptionProps {
  /** DOM anchor for the radiogroup's roving-tabindex focus management. */
  planKey: PlanKey;
  selected: boolean;
  onSelect: () => void;
  label: string;
  price: string;
  period: string;
  badge?: string;
  subline: string | null;
  feature: { text: string; tone: 'brand' | 'muted' } | null;
}

/**
 * A real ARIA radio (role="radio" + aria-checked) rendered on the `Card`
 * primitive's own `onPress` button — not a native `<input type="radio">`
 * hidden under a `<label>`. The whole card is the hit target; `RadioDot` is a
 * purely decorative echo of the checked state for sighted users.
 *
 * Roving tabindex (WAI-ARIA APG): only the SELECTED card is in the tab order
 * (`tabIndex={selected ? 0 : -1}`) — the other option is reached with the
 * arrow keys, handled by the parent radiogroup's `onKeyDown`, which also
 * needs a DOM handle back to "the newly selected card" to move focus. `Card`
 * is not built with `forwardRef`, so that handle is a `data-plan-key`
 * attribute the radiogroup queries for, not a React ref.
 */
function PlanOption({
  planKey,
  selected,
  onSelect,
  label,
  price,
  period,
  badge,
  subline,
  feature,
}: PlanOptionProps): ReactElement {
  return (
    <Card
      variant="outlined"
      padding="md"
      onPress={onSelect}
      role="radio"
      aria-checked={selected}
      aria-label={`${label}, ${price} ${period}`}
      data-plan-key={planKey}
      tabIndex={selected ? 0 : -1}
      className={[
        'relative flex flex-col text-left transition-shadow',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-coral has-[:focus-visible]:ring-offset-2',
        // Selection = moss (the primary-action colour), calm and lighter than
        // the CTA. BOTH states keep Card's 1px `border`; the selected card only
        // recolours it and adds a 1px `ring` (box-shadow — no layout), so the
        // box size and content position are identical whichever is selected.
        // (It used to be `border-2 border-ink! bg-coral-soft!`: an alert-looking
        // pink/black block whose content sat 2px lower than its neighbour.)
        // `!` on the colours: Card's own `border-line-2` and `bg-cream` are
        // emitted LATER in the compiled stylesheet, so a plain override loses
        // the cascade — same reasoning as Eyebrow.tsx / inputStyles.ts.
        selected
          ? 'border-moss! ring-1 ring-moss bg-moss-wash!'
          : 'border-line! hover:shadow-md',
      ].join(' ')}
    >
      {/* min-h-6: the Save pill (22px) is taller than the label row (~20.7px),
          so without a shared floor the card WITH the pill centred its title
          ~0.7px lower and its price ~1.3px lower than the card without one. */}
      <div className="flex min-h-6 items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <RadioDot selected={selected} />
          <Text variant="h3" as="span">
            {label}
          </Text>
        </span>
        {badge && (
          <Badge variant="primary" size="sm">
            {badge}
          </Badge>
        )}
      </div>

      <p className="m-0 mt-4 flex items-baseline gap-1.5">
        <Text variant="editorialTitle" as="span">
          {price}
        </Text>
        <Text variant="caption" as="span">
          {period}
        </Text>
      </p>
      {/* Reserve a line so both cards align even when one has no sub-price. */}
      <Text variant="caption" className="mt-1 min-h-5">
        {subline ?? ' '}
      </Text>

      {feature && (
        <p
          className={[
            // items-start + icon mt-0.5: ES "Cancela cuando quieras, sin
            // compromiso" wraps at desktop width, and a centred check floated
            // between its two lines.
            'm-0 mt-3 flex items-start gap-2 text-sm',
            feature.tone === 'brand' ? 'font-medium text-moss-deep' : 'text-ink-2',
          ].join(' ')}
        >
          <Icon
            name="checkmark"
            size="inline"
            className={`mt-0.5 shrink-0 ${feature.tone === 'brand' ? 'text-moss' : 'text-ink-3'}`}
          />
          {feature.text}
        </p>
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
        selected ? 'border-moss bg-moss' : 'border-ink/30',
      ].join(' ')}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-white" />}
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
