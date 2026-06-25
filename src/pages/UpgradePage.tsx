import { useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Spinner, useToast } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { isWebBillingConfigured, isUserCancelledError, type WebPlan } from '@/lib/purchases';

/**
 * Web purchase page (RevenueCat Web Billing). Free users land here from the
 * Upgrade CTA; on a successful purchase the existing RC webhook flips
 * `plan_tier`, and the hook invalidates `subscription-status` + `circles` so the
 * rest of the app reflects premium. Mirrors the mobile paywall's tiers/copy.
 */
export default function UpgradePage(): ReactElement {
  const { t } = useTranslation('upgrade');
  const navigate = useNavigate();
  const { showToast } = useToast();

  const { data: status } = useSubscriptionStatus();
  const { data: plans, isLoading } = useWebPlans();
  const purchase = usePurchasePlan();
  const manage = useManageSubscription();
  const [purchased, setPurchased] = useState(false);

  const isPremium = status?.tier === 'premium';

  const handleManage = (): void => {
    manage.mutate(undefined, {
      onSuccess: (url) => {
        if (!url) showToast(t('alreadyPremium.manageInApp'), 'info');
      },
      onError: () => showToast(t('alreadyPremium.manageInApp'), 'info'),
    });
  };

  const handleSubscribe = (plan: WebPlan): void => {
    purchase.mutate(plan, {
      onSuccess: () => setPurchased(true),
      onError: (err) => {
        // The user dismissing RevenueCat's checkout is not a failure.
        if (isUserCancelledError(err)) return;
        showToast(t('error'), 'error');
      },
    });
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-6 py-12 md:py-16">
      {!isWebBillingConfigured() ? (
        <Panel>
          <p className="m-0 text-ink-2">{t('unavailable')}</p>
          <div className="mt-5">
            <StoreBadges layout="row" />
          </div>
          <BackLink onClick={() => navigate('/profile')}>{t('back')}</BackLink>
        </Panel>
      ) : purchased ? (
        <Panel center>
          <PremiumMark />
          <h1 className="serif mt-5 text-3xl text-ink">{t('success.title')}</h1>
          <p className="mx-auto mt-2 max-w-md text-ink-3">{t('success.body')}</p>
          <Button className="mt-7" onClick={() => navigate('/circles')}>
            {t('success.cta')}
          </Button>
        </Panel>
      ) : isPremium ? (
        <Panel center>
          <PremiumMark />
          <h1 className="serif mt-5 text-3xl text-ink">{t('alreadyPremium.title')}</h1>
          <p className="mx-auto mt-2 max-w-md text-ink-3">{t('alreadyPremium.body')}</p>
          <Button
            variant="ghost"
            className="mt-7"
            disabled={manage.isPending}
            onClick={handleManage}
          >
            {t('alreadyPremium.manage')}
          </Button>
          <BackLink onClick={() => navigate('/profile')}>{t('back')}</BackLink>
        </Panel>
      ) : isLoading ? (
        <div className="flex justify-center py-20">
          <Spinner size={32} />
        </div>
      ) : (
        <PlansView
          plans={plans}
          pending={purchase.isPending}
          onSubscribe={handleSubscribe}
          onBack={() => navigate('/profile')}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

interface PlansViewProps {
  plans: { monthly: WebPlan | null; annual: WebPlan | null } | undefined;
  pending: boolean;
  onSubscribe: (plan: WebPlan) => void;
  onBack: () => void;
}

function PlansView({ plans, pending, onSubscribe, onBack }: PlansViewProps): ReactElement {
  const { t } = useTranslation('upgrade');

  const monthly = plans?.monthly ?? null;
  const annual = plans?.annual ?? null;
  const anyTrial = Boolean(monthly?.hasFreeTrial || annual?.hasFreeTrial);

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
  const cta = pending
    ? t('subscribing')
    : selectedPlan?.hasFreeTrial
      ? t('startTrial')
      : t('subscribe');

  return (
    <div className="flex flex-col items-center text-center">
      <p className="eyebrow text-terracotta-deep">{t('eyebrow')}</p>
      <h1 className="serif mt-2 text-3xl leading-tight text-ink md:text-[2.4rem]">{t('title')}</h1>
      <p className="mt-3 max-w-xl text-base text-ink-3">{t('subtitle')}</p>
      {anyTrial && (
        <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-terracotta-soft px-4 py-1.5 text-sm font-medium text-terracotta-deep">
          {t('trialHook')}
        </p>
      )}

      <ul className="mx-auto mt-8 grid w-full max-w-2xl list-none grid-cols-1 gap-x-6 gap-y-3 p-0 text-left sm:grid-cols-3">
        {(['members', 'tools', 'sync'] as const).map((key) => (
          <li key={key} className="flex items-start gap-2 text-sm text-ink-2">
            <CheckIcon />
            {t(`benefits.${key}`)}
          </li>
        ))}
      </ul>

      {/* Native radios in labels: full keyboard support (arrow keys, focus) for
          free, whole card is the hit target, one focusable control per option. */}
      <fieldset className="m-0 mt-10 w-full max-w-2xl border-0 p-0">
        <legend className="sr-only">{t('choosePlan')}</legend>
        <div className="grid grid-cols-1 items-stretch gap-5 sm:grid-cols-2">
          {annual && (
            <PlanOption
              name="plan"
              value="annual"
              selected={selectedPlan === annual}
              onSelect={() => setSelected('annual')}
              label={t('plans.annual')}
              price={annual.formattedPrice}
              period={t('plans.perYear')}
              badge={savePercent ? t('plans.savePercent', { percent: savePercent }) : t('plans.bestValue')}
              subline={perMonthEquivalent ? t('plans.perMonthBilled', { price: perMonthEquivalent }) : null}
              feature={annual.hasFreeTrial ? { text: t('plans.trialIncluded'), tone: 'brand' } : null}
            />
          )}
          {monthly && (
            <PlanOption
              name="plan"
              value="monthly"
              selected={selectedPlan === monthly}
              onSelect={() => setSelected('monthly')}
              label={t('plans.monthly')}
              price={monthly.formattedPrice}
              period={t('plans.perMonth')}
              subline={t('plans.billedMonthly')}
              feature={
                monthly.hasFreeTrial
                  ? { text: t('plans.trialIncluded'), tone: 'brand' }
                  : { text: t('plans.monthlyPerk'), tone: 'muted' }
              }
            />
          )}
        </div>
      </fieldset>

      <Button
        variant="terracotta"
        size="lg"
        className="mt-8 w-full sm:w-auto sm:min-w-[18rem]"
        disabled={pending || !selectedPlan}
        onClick={() => selectedPlan && onSubscribe(selectedPlan)}
      >
        {cta}
      </Button>

      <p className="mt-4 text-xs text-ink-3">
        {t('cancelAnytime')} {t('securedByStripe')}
      </p>

      {/* The mobile path stays available alongside web checkout. */}
      <div className="mt-8 w-full max-w-md border-t border-line pt-6">
        <p className="m-0 mb-3 text-sm text-ink-3">{t('orUseApp')}</p>
        <div className="flex justify-center">
          <StoreBadges layout="row" />
        </div>
      </div>

      <BackLink onClick={onBack}>{t('back')}</BackLink>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type PlanKey = 'annual' | 'monthly';

interface PlanOptionProps {
  name: string;
  value: PlanKey;
  selected: boolean;
  onSelect: () => void;
  label: string;
  price: string;
  period: string;
  badge?: string;
  subline: string | null;
  feature: { text: string; tone: 'brand' | 'muted' } | null;
}

function PlanOption({
  name,
  value,
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
    <label
      className={[
        'relative flex cursor-pointer flex-col rounded-2xl border-2 p-6 text-left transition-shadow',
        'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-terracotta has-[:focus-visible]:ring-offset-2',
        selected
          ? 'border-terracotta-deep bg-terracotta-soft shadow-sm'
          : 'border-line bg-cream hover:shadow-md',
      ].join(' ')}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onSelect}
        aria-label={`${label}, ${price} ${period}`}
        className="sr-only"
      />

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2.5">
          <RadioDot selected={selected} />
          <span className="text-lg font-semibold text-ink">{label}</span>
        </span>
        {badge && (
          <span className="inline-flex items-center rounded-full bg-terracotta-deep px-2.5 py-0.5 text-xs font-semibold text-white">
            {badge}
          </span>
        )}
      </div>

      <p className="m-0 mt-4 flex items-baseline gap-1.5">
        <span className="serif text-4xl text-ink">{price}</span>
        <span className="text-sm text-ink-3">{period}</span>
      </p>
      {/* Reserve a line so both cards align even when one has no sub-price. */}
      <p className="m-0 mt-1 min-h-5 text-sm text-ink-3">{subline ?? ' '}</p>

      {feature && (
        <p
          className={[
            'm-0 mt-3 flex items-center gap-2 text-sm',
            feature.tone === 'brand' ? 'font-medium text-terracotta-deep' : 'text-ink-2',
          ].join(' ')}
        >
          <CheckIcon className={feature.tone === 'brand' ? 'text-terracotta-deep' : 'text-ink-3'} />
          {feature.text}
        </p>
      )}
    </label>
  );
}

function RadioDot({ selected }: { selected: boolean }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={[
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
        selected ? 'border-terracotta-deep bg-terracotta-deep' : 'border-ink/30',
      ].join(' ')}
    >
      {selected && <span className="h-2 w-2 rounded-full bg-white" />}
    </span>
  );
}

/* ----------------------------- bits ----------------------------- */

function Panel({
  children,
  center = false,
}: {
  children: ReactNode;
  center?: boolean;
}): ReactElement {
  return (
    <div
      className={[
        'mx-auto max-w-md rounded-2xl border border-line bg-cream p-8',
        center ? 'text-center' : '',
      ].join(' ')}
    >
      {children}
    </div>
  );
}

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

function CheckIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      className={['mt-0.5 shrink-0', className ?? 'text-terracotta-deep'].join(' ')}
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}

function PremiumMark(): ReactElement {
  return (
    <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-terracotta-soft text-terracotta-deep">
      <svg
        aria-hidden="true"
        width={28}
        height={28}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m5 12 5 5L20 7" />
      </svg>
    </span>
  );
}

function formatMoney(amountMicros: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(
    amountMicros / 1_000_000
  );
}
