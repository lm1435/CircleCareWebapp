import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';

vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
}));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: vi.fn() }));
vi.mock('@/lib/purchases', () => ({
  isUserCancelledError: vi.fn(() => false),
}));
vi.mock('@/lib/webBillingConfig', () => ({
  isWebBillingConfigured: vi.fn(() => true),
}));
// The ACCOUNT's saved IANA zone (`users.timezone`), the country gate's only
// input. Mocked at the hook, not at the gate: the tests below feed it REAL
// zone strings so `lib/checkoutCountry` — the allowlist, the mapping and the
// fail-open branch — runs for real inside the page.
vi.mock('@/hooks/useAccountTimezone', () => ({ useAccountTimezone: vi.fn() }));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { useAccountTimezone } from '@/hooks/useAccountTimezone';
import { WEB_CHECKOUT_COUNTRIES, ZONES_BY_COUNTRY } from '@/lib/checkoutCountry';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/storeLinks';
import * as purchases from '@/lib/purchases';
import * as webBillingConfig from '@/lib/webBillingConfig';
import UpgradePage from '@/pages/UpgradePage';

const mockedPlans = useWebPlans as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = usePurchasePlan as unknown as ReturnType<typeof vi.fn>;
const mockedManage = useManageSubscription as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;
const mockedTimezone = useAccountTimezone as unknown as ReturnType<typeof vi.fn>;

const refetchCountry = vi.fn();

/** A settled `/users/me` carrying a usable zone. */
function setAccountZone(timezone: string): void {
  mockedTimezone.mockReturnValue({ timezone, isPending: false, refetch: refetchCountry });
}

/** `/users/me` still in flight. */
function setAccountPending(): void {
  mockedTimezone.mockReturnValue({
    timezone: undefined,
    isPending: true,
    refetch: refetchCountry,
  });
}

/** `/users/me` failed, or answered with no usable zone. NOT "abroad". */
function setAccountUnresolved(): void {
  mockedTimezone.mockReturnValue({
    timezone: undefined,
    isPending: false,
    refetch: refetchCountry,
  });
}

/**
 * THE SECOND SIGNAL — the browser's live zone, which the page reads straight
 * off `Intl`. It MUST be pinned in every test here: unpinned it is the
 * runner's own `TZ`, and `scripts/run-unit-timezones.sh` deliberately runs
 * this suite under UTC, Asia/Tokyo, Pacific/Midway and seven more. A test
 * that let the process zone through would pass on the dev machine
 * (America/Denver, allowlisted) and fail in eight of the ten sweep zones.
 *
 * Patched on the PROTOTYPE, preserving the engine's real options and swapping
 * only `timeZone`, so i18next and anything else formatting dates in this file
 * keeps working.
 */
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
function setBrowserZone(timeZone: string | undefined): void {
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(
    this: Intl.DateTimeFormat
  ) {
    return { ...realResolvedOptions.call(this), timeZone: timeZone as string };
  };
}
/** A privacy-hardened engine that refuses to answer. */
function breakBrowserZone(): void {
  Intl.DateTimeFormat.prototype.resolvedOptions = () => {
    throw new Error('blocked');
  };
}
afterEach(() => {
  Intl.DateTimeFormat.prototype.resolvedOptions = realResolvedOptions;
});

/** Pointer class decides the store-only copy (deep-link vs "on your phone"). */
function stubPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: coarse,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

const mutate = vi.fn();
const manageMutate = vi.fn();

function renderPage(): void {
  render(
    <MemoryRouter>
      <ToastProvider>
        <UpgradePage />
      </ToastProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks() drops call records but KEEPS implementations. The
  // "billing not configured" test sets this to false, and without restoring it
  // every later test rendered the unconfigured state instead of the plans — so
  // the radios and prices were simply absent under a shuffled order.
  (webBillingConfig.isWebBillingConfigured as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    true
  );
  (purchases.isUserCancelledError as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
  // Default every existing test to an allowed country on BOTH signals, so the
  // country gate is a no-op unless a test deliberately moves one of them.
  setAccountZone('America/New_York');
  setBrowserZone('America/New_York');
  vi.unstubAllGlobals();
  mockedStatus.mockReturnValue({ data: { tier: 'free' } });
  mockedPlans.mockReturnValue({
    data: {
      monthly: {
        rcPackage: {},
        identifier: '$rc_monthly',
        formattedPrice: '$6.99',
        priceMicros: 6_990_000,
        currency: 'USD',
        hasFreeTrial: false,
        trialPeriod: null,
      },
      annual: {
        rcPackage: {},
        identifier: '$rc_annual',
        formattedPrice: '$59.99',
        priceMicros: 59_990_000,
        currency: 'USD',
        hasFreeTrial: true,
        // What the store actually returns today: web_premium_yearly_1wk's P1W
        // trial, which purchases-js hands over as {number: 1, unit: 'week'}.
        // Omitting it silently tested the duration-LESS fallback copy instead.
        trialPeriod: { number: 1, unit: 'week' },
      },
    },
    isLoading: false,
  });
  mockedPurchase.mockReturnValue({ mutate, isPending: false });
  mockedManage.mockReturnValue({ mutate: manageMutate, isPending: false });
});

describe('UpgradePage', () => {
  // The benefits are what Premium ADDS, the same six, in the same order and
  // wording, as mobile's paywall (planSelection.feature*). ORDER IS THE POINT
  // (owner-approved 2026-10-10): people pay for more people in ONE circle (the
  // capacity paywall converts 2x onboarding), so unlimited family members lead
  // and the circle-count cap is LAST. The old "Full access to the calendar,
  // tasks, medications, documents, and vitals" overclaimed: free users have it.
  it('lists the six Premium benefits mobile lists, family members first, circles last', () => {
    renderPage();
    const items = screen.getAllByRole('listitem').filter((li) => li.closest('[data-benefits]'));
    expect(items.map((li) => li.textContent)).toEqual([
      'Unlimited family membersEveryone who helps, in one circle. One person pays.',
      'Add by voiceSay a medication, task or appointment and we fill in the form. On supported phones.',
      'Adherence reports & calendar importShare medication history with providers, import appointments from your calendar',
      '1GB of documents per circleRoom for records, photos, and paperwork',
      'AI care assistantSummarizes visits and surfaces what matters',
      'Up to 5 care circlesOne for Mom, Dad, or the whole family',
    ]);
    expect(screen.queryByText(/Full access to the calendar/)).toBeNull();
  });

  it('lists the same order in Spanish', async () => {
    await i18n.changeLanguage('es');
    try {
      renderPage();
      const items = screen.getAllByRole('listitem').filter((li) => li.closest('[data-benefits]'));
      const titles = items.map((li) => li.querySelector('.font-medium')?.textContent);
      expect(titles).toEqual([
        'Familiares ilimitados',
        'Agregar por voz',
        'Informes de adherencia e importación de calendario',
        '1GB de documentos por círculo',
        'Asistente de IA',
        'Hasta 5 círculos de cuidado',
      ]);
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  // The free baseline must match the free plan everywhere else: owner + 1
  // caregiver (it said "two caregivers"), and reminders are never paywalled.
  it('states the free plan truthfully: you + 1 caregiver, free medication reminders', () => {
    renderPage();
    expect(
      screen.getByText(
        'The free plan includes one care circle, you + 1 caregiver, and free medication reminders.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/two caregivers/)).toBeNull();
  });

  // At 390px the ES pill ("Comienza con una prueba gratis de 1 semana: hoy no
  // pagas nada.") was a nowrap Badge wider than the viewport: horizontal page
  // scroll. The trial pill must be allowed to wrap inside the viewport, centred.
  it('lets the trial pill wrap within the viewport (no whitespace-nowrap)', () => {
    renderPage();
    const pill = screen.getByText('Start with a 1-week free trial — nothing due today.');
    const classes = pill.className.split(/\s+/);
    expect(classes).not.toContain('whitespace-nowrap');
    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('max-w-full');
    expect(classes).toContain('text-center');
    expect(classes).toContain('rounded-full');
  });

  // Coral-deep on coral-soft is the palette's alert look; "nothing due today"
  // is reassurance, so it wears the same moss as "Save 28%" and the CTA.
  it('renders the trial pill in moss, not the coral alert tint', () => {
    renderPage();
    const classes = screen.getByText(
      'Start with a 1-week free trial — nothing due today.'
    ).className;
    expect(classes).toContain('bg-moss-soft');
    expect(classes).toContain('text-moss-deep');
    expect(classes).not.toMatch(/coral/);
  });

  it('renders both plans with their Stripe prices', () => {
    renderPage();
    expect(screen.getByText('$6.99')).toBeInTheDocument();
    expect(screen.getByText('$59.99')).toBeInTheDocument();
  });

  // All four markets we sell to on the web (US, CA, AU, NZ) use a bare `$` in
  // their own locale, so the symbol alone never says WHICH dollar. A Canadian
  // seeing "$79.99" has nothing on the page telling them it is not USD they
  // will have to convert. The ISO code is the disambiguator.
  it('names the currency beside each price', () => {
    renderPage();
    expect(screen.getAllByText('USD').length).toBe(2);
  });

  it('puts the currency in the radio accessible name, not just the visual', () => {
    renderPage();
    // A screen-reader user gets the same disambiguation a sighted user does.
    expect(screen.getByRole('radio', { name: /Annual, \$59\.99 USD per year/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Monthly, \$6\.99 USD per month/ })).toBeInTheDocument();
  });

  // The duration has to reach the CARD too, not just the hero pill: the card's
  // trial line is what a user reads while choosing, and "Free trial included"
  // with no length is exactly the unqualified claim FTC/Play enforcement
  // targets.
  it('states the trial length on the annual plan card, not just the hero pill', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    expect(annualRadio).toHaveTextContent('1-week free trial');
    expect(annualRadio).not.toHaveTextContent('Free trial included');
  });

  // WCAG 1.4.3: plain (non-deep) coral is 3.92:1 on the page background at
  // this 12px/normal-weight eyebrow size — below the 4.5:1 AA text minimum.
  // `deep` renders coral-deep (5.4:1).
  it('renders the hero eyebrow in coral-deep, not plain coral (WCAG 1.4.3)', () => {
    renderPage();
    const eyebrow = screen.getByText('CircleCare Premium');
    expect(eyebrow.className).toContain('text-coral-deep!');
    expect(eyebrow.className).not.toContain('text-coral!');
  });

  it('shows the data-driven annual savings and per-month equivalent', () => {
    renderPage();
    // 59.99 vs 6.99×12 (83.88) → ~28% off; 59.99/12 → $5.00/mo
    expect(screen.getByText('Save 28%')).toBeInTheDocument();
    expect(screen.getByText('$5.00/mo, billed yearly')).toBeInTheDocument();
  });

  it('offers both plans as radio options, annual selected by default', () => {
    renderPage();
    expect(screen.getByRole('radio', { name: /Annual/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Monthly/ })).not.toBeChecked();
    // One shared CTA, reflecting the default (annual → free trial)
    expect(screen.getByRole('button', { name: 'Start free trial' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
  });

  // The selected card used to be `border-2 border-ink! bg-coral-soft! shadow-sm`:
  // a pink fill under a heavy black 2px frame read as an error state, was the
  // heaviest thing on the page, and — because the unselected card kept a 1px
  // border — the selected card's content sat ~2px lower and jumped on toggle.
  // Selection is now moss (the primary-action colour), drawn as a border COLOUR
  // plus a 1px ring (box-shadow, no layout), so both states share one border
  // width and the box/content never move.
  it('marks the selected plan card in moss with no layout-shifting border change, and flips on click', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const monthlyRadio = screen.getByRole('radio', { name: /Monthly/ });
    const tokens = (el: HTMLElement): string[] => el.className.split(/\s+/);
    const borderWidth = (el: HTMLElement): string[] =>
      tokens(el).filter((c) => /^border(-[0-9]+)?$/.test(c) || /^border-[xytrbl]-?[0-9]*$/.test(c));

    const assertSelected = (el: HTMLElement): void => {
      expect(el).toHaveAttribute('aria-checked', 'true');
      const c = tokens(el);
      expect(c).toContain('border-moss!');
      expect(c).toContain('ring-1');
      expect(c).toContain('ring-moss');
      // Never the old alert-looking treatment.
      expect(el.className).not.toMatch(/bg-coral-soft|border-ink|border-2/);
    };
    const assertUnselected = (el: HTMLElement): void => {
      expect(el).toHaveAttribute('aria-checked', 'false');
      const c = tokens(el);
      expect(c).toContain('border-line!');
      expect(c).not.toContain('ring-1');
      expect(el.className).not.toMatch(/moss!|bg-coral-soft|border-ink|border-2/);
    };

    assertSelected(annualRadio);
    assertUnselected(monthlyRadio);
    // Identical border-width token in both states: box size cannot change.
    expect(borderWidth(annualRadio)).toEqual(['border']);
    expect(borderWidth(monthlyRadio)).toEqual(['border']);

    fireEvent.click(monthlyRadio);

    assertSelected(monthlyRadio);
    assertUnselected(annualRadio);
    expect(borderWidth(annualRadio)).toEqual(['border']);
    expect(borderWidth(monthlyRadio)).toEqual(['border']);
  });

  it('keeps the plan cards moss/ink, not coral (savings pill + trial line)', () => {
    renderPage();
    const save = screen.getByText('Save 28%');
    expect(save.className).toContain('bg-moss-soft');
    expect(save.className).toContain('text-moss-deep');
    expect(save.className).not.toContain('coral');

    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const trialLine = annualRadio.querySelector('p:last-of-type') as HTMLElement;
    expect(trialLine.className).toContain('text-moss-deep');
    expect(annualRadio.innerHTML).not.toContain('coral');
  });

  // EN desktop broke "…for every circle you're part / of." — a one-word widow.
  it('balances the subtitle so it never leaves a one-word last line', () => {
    renderPage();
    const subtitle = screen.getByText(/Everything your family needs to coordinate care/);
    expect(subtitle.className.split(/\s+/)).toContain('text-balance');
  });

  it('gives exactly one plan card a tab stop (roving tabindex)', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const monthlyRadio = screen.getByRole('radio', { name: /Monthly/ });

    // Annual is selected by default.
    expect(annualRadio).toHaveAttribute('tabIndex', '0');
    expect(monthlyRadio).toHaveAttribute('tabIndex', '-1');

    fireEvent.click(monthlyRadio);

    expect(monthlyRadio).toHaveAttribute('tabIndex', '0');
    expect(annualRadio).toHaveAttribute('tabIndex', '-1');
  });

  it('ArrowRight selects the other plan and moves focus to it (WAI-ARIA APG radiogroup)', () => {
    renderPage();
    const annualRadio = screen.getByRole('radio', { name: /Annual/ });
    const monthlyRadio = screen.getByRole('radio', { name: /Monthly/ });

    annualRadio.focus();
    expect(annualRadio).toHaveFocus();

    fireEvent.keyDown(annualRadio, { key: 'ArrowRight' });

    expect(monthlyRadio).toHaveAttribute('aria-checked', 'true');
    expect(monthlyRadio).toHaveAttribute('tabIndex', '0');
    expect(annualRadio).toHaveAttribute('tabIndex', '-1');
    expect(monthlyRadio).toHaveFocus();

    // ArrowLeft (or wraparound ArrowRight) brings it back.
    fireEvent.keyDown(monthlyRadio, { key: 'ArrowLeft' });
    expect(annualRadio).toHaveAttribute('aria-checked', 'true');
    expect(annualRadio).toHaveFocus();
  });

  it('confirms the selected plan (annual by default) via the shared CTA', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Start free trial' }));
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ identifier: '$rc_annual' });
  });

  it('switches the CTA and the confirmed plan when monthly is selected', () => {
    renderPage();
    fireEvent.click(screen.getByRole('radio', { name: /Monthly/ }));
    // Monthly has no trial → CTA becomes Subscribe
    const cta = screen.getByRole('button', { name: 'Subscribe' });
    fireEvent.click(cta);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ identifier: '$rc_monthly' });
  });

  it('shows the manage-subscription state for premium users', () => {
    mockedStatus.mockReturnValue({ data: { tier: 'premium' } });
    renderPage();
    expect(screen.getByText("You're already Premium")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Manage subscription' }));
    expect(manageMutate).toHaveBeenCalledTimes(1);
  });

  // axe route crawl: page-has-heading-one. The already-premium state renders
  // only an EmptyState with no other heading on the page, so its title must be
  // the page's <h1> (EmptyState's titleAs="h1"), not the default <h2>.
  it('gives the already-premium state a level-1 heading', () => {
    mockedStatus.mockReturnValue({ data: { tier: 'premium' } });
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: "You're already Premium" })
    ).toBeInTheDocument();
  });

  it('degrades to an unavailable notice when web billing is off', async () => {
    const webBillingConfig = await import('@/lib/webBillingConfig');
    (
      webBillingConfig.isWebBillingConfigured as unknown as ReturnType<typeof vi.fn>
    ).mockReturnValue(false);
    renderPage();
    expect(
      screen.getByText(/Online checkout isn't available/i)
    ).toBeInTheDocument();
  });

  it('degrades to the in-app upgrade notice when the offering loads no plans', () => {
    // Web billing configured, but the offering came back empty (bad key / CSP /
    // RC outage) — show the unavailable panel, never a dead Subscribe button.
    mockedPlans.mockReturnValue({ data: { monthly: null, annual: null }, isLoading: false });
    renderPage();
    expect(screen.getByText(/Online checkout isn't available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start free trial' })).not.toBeInTheDocument();
  });

  it('degrades to the in-app upgrade notice when the offering query errors', () => {
    mockedPlans.mockReturnValue({ data: undefined, isLoading: false, isError: true });
    renderPage();
    expect(screen.getByText(/Online checkout isn't available/i)).toBeInTheDocument();
  });
});

/**
 * THE COUNTRY GATE (docs/plans/country-pricing.md, Part 5).
 *
 * Web checkout makes Maple Ridge LLC the merchant of record, which is a
 * VAT/GST registration obligation — in the UK, the EU, Mexico, Colombia, Chile
 * and Peru from the very first sale. So the web paywall transacts only in the
 * US, Canada, Australia and New Zealand, and everyone else is routed to the
 * app stores, where Apple and Google are the merchant of record.
 *
 * The gate reads the ACCOUNT's `users.timezone`, which is why these tests set
 * a zone rather than a country: that is the only signal the page has.
 */
describe('UpgradePage — country gate', () => {
  const blockedZone = 'America/Mexico_City';

  const queryPlanControls = (): HTMLElement[] => [
    ...screen.queryAllByRole('radiogroup'),
    ...screen.queryAllByRole('radio'),
    ...screen.queryAllByRole('button', { name: 'Subscribe' }),
    ...screen.queryAllByRole('button', { name: 'Start free trial' }),
  ];

  it('renders the plan selector when both zones are on the allowlist', () => {
    setAccountZone('America/Toronto');
    setBrowserZone('America/Vancouver');
    renderPage();
    expect(screen.getByRole('radio', { name: /Annual/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start free trial' })).toBeInTheDocument();
  });

  // Every country on the allowlist, driven off the constant itself — adding a
  // country must not need this test edited, and REMOVING one must fail here.
  it.each(WEB_CHECKOUT_COUNTRIES.map((c) => [c, ZONES_BY_COUNTRY[c][0]] as const))(
    'renders the plan selector in %s (%s)',
    (_country, zone) => {
      setAccountZone(zone);
      setBrowserZone(zone);
      renderPage();
      expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    }
  );

  // ── THE SECOND SIGNAL ────────────────────────────────────────────────────
  //
  // `users.timezone` is written ONCE, at signup, and never refreshed (mobile's
  // `syncDeviceSettings` skips a non-empty column). So an allowlisted account
  // zone only proves where somebody was when they created the account — it
  // does not say they are there now. Under the single-signal gate every one of
  // these transacted.
  it.each([
    ['Europe/London', 'signed up in the US, buying from London'],
    ['America/Mexico_City', 'signed up in the US, buying from Mexico City'],
    ['Asia/Bangkok', 'signed up in the US, buying from Bangkok'],
  ])('blocks an allowlisted account used from %s (%s)', (browserZone) => {
    setAccountZone('America/New_York');
    setBrowserZone(browserZone);
    renderPage();
    expect(queryPlanControls()).toHaveLength(0);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Subscribe in the CircleCare app' })
    ).toBeInTheDocument();
  });

  // The mirror image. A stale account zone cuts both ways: someone who signed
  // up abroad and has since moved is still stamped with the old zone, and the
  // gate does not take the browser's word for it either.
  it.each(['America/Denver', 'America/Toronto'])(
    'blocks a non-allowlisted account even when the browser is in %s',
    (browserZone) => {
      setAccountZone('America/Mexico_City');
      setBrowserZone(browserZone);
      renderPage();
      expect(queryPlanControls()).toHaveLength(0);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Subscribe in the CircleCare app' })
      ).toBeInTheDocument();
    }
  );

  // Stated so nobody reads the case above as a bug and adds a bypass: this is
  // the accepted cost of settling eligibility "100% without question". The
  // traveller still has a working purchase path two taps away, in the app.
  it('blocks a genuine US customer subscribing while travelling — the accepted tradeoff', () => {
    setAccountZone('America/Chicago');
    setBrowserZone('Europe/Lisbon');
    renderPage();
    expect(queryPlanControls()).toHaveLength(0);
    expect(screen.getByRole('link', { name: /App Store/i })).toBeInTheDocument();
  });

  // An engine that will not report a zone is a machine condition, not a
  // foreign buyer — same reasoning as a failed `/users/me`.
  it('shows the retryable error, not the store card, when the browser zone is unavailable', () => {
    setAccountZone('America/New_York');
    setBrowserZone(undefined);
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: "We couldn't load your account" })
    ).toBeInTheDocument();
    expect(screen.queryByText('Subscribe in the CircleCare app')).toBeNull();
    expect(queryPlanControls()).toHaveLength(0);
  });

  it('shows the retryable error, not the store card, when reading the browser zone throws', () => {
    setAccountZone('America/New_York');
    breakBrowserZone();
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: "We couldn't load your account" })
    ).toBeInTheDocument();
    expect(screen.queryByText('Subscribe in the CircleCare app')).toBeNull();
    expect(queryPlanControls()).toHaveLength(0);
  });

  it('does not allow checkout when the browser zone is blank', () => {
    setAccountZone('America/New_York');
    setBrowserZone('   ');
    renderPage();
    expect(queryPlanControls()).toHaveLength(0);
  });

  // NOT MERELY DISABLED. A disabled Subscribe button is still a control a
  // screen reader announces and a keyboard lands on, and it advertises a
  // checkout that will never open.
  it('renders no plan selector and no Subscribe control in a blocked country', () => {
    setAccountZone(blockedZone);
    renderPage();
    expect(queryPlanControls()).toHaveLength(0);
    expect(screen.queryByText('$59.99')).toBeNull();
    expect(screen.queryByText('$6.99')).toBeNull();
  });

  it('shows the app-store route as the way to subscribe, with both store links', () => {
    setAccountZone(blockedZone);
    renderPage();

    // A terminal, whole-page state, so its title is the page's <h1>
    // (axe route crawl: page-has-heading-one).
    expect(
      screen.getByRole('heading', { level: 1, name: 'Subscribe in the CircleCare app' })
    ).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /App Store/i })).toHaveAttribute(
      'href',
      APP_STORE_URL
    );
    expect(screen.getByRole('link', { name: /Google Play/i })).toHaveAttribute(
      'href',
      PLAY_STORE_URL
    );
  });

  // The copy is a route, not a rejection: the reason we do this is an internal
  // tax question and must never surface to a caregiver.
  it('never names a region, a country or a tax reason in the blocked copy', () => {
    setAccountZone(blockedZone);
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <UpgradePage />
        </ToastProvider>
      </MemoryRouter>
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/region|country|tax|VAT|GST|available in your|unavailable/i);
  });

  it('deep-links to the store on a touch device', () => {
    stubPointer(true);
    setAccountZone(blockedZone);
    renderPage();
    expect(screen.getByText(/Get CircleCare below/)).toBeInTheDocument();
    expect(screen.queryByText(/on your phone/)).toBeNull();
  });

  // "Visit the App Store" is meaningless on a laptop — say where the purchase
  // actually happens.
  it('tells a desktop visitor the purchase happens on their phone', () => {
    stubPointer(false);
    setAccountZone(blockedZone);
    renderPage();
    expect(screen.getByText(/on your phone/)).toBeInTheDocument();
    expect(screen.queryByText(/Get CircleCare below/)).toBeNull();
  });

  // Without this, a desktop user with no smartphone has no recourse at all.
  it('offers a support contact as an escape hatch', () => {
    setAccountZone(blockedZone);
    renderPage();
    const support = screen.getByRole('link', { name: /Email our support team/i });
    expect(support).toHaveAttribute('href', 'mailto:support@circlecare.app');
  });

  it('still lets a blocked user leave the page', () => {
    setAccountZone(blockedZone);
    renderPage();
    expect(screen.getByRole('button', { name: 'Back to profile' })).toBeInTheDocument();
  });

  // A premium subscriber abroad must still reach the management link — the
  // gate is about STARTING a subscription, not about servicing one.
  it('does not hide the manage-subscription state from a premium user abroad', () => {
    setAccountZone(blockedZone);
    mockedStatus.mockReturnValue({ data: { tier: 'premium' } });
    renderPage();
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeInTheDocument();
  });

  // ── THE BEHAVIOUR CHANGE: FAIL CLOSED ────────────────────────────────────
  //
  // These zones are real places, and no table in the codebase names them. The
  // gate used to let every one of them through to Subscribe on the grounds
  // that it could not prove they were foreign. It is an allowlist now: not
  // being named IS the answer, because one sale is the whole trigger.
  it.each([
    'Africa/Lagos',
    'Asia/Bangkok',
    'Europe/Vilnius',
    'Pacific/Fiji',
    'Atlantic/Reykjavik',
    'Mars/Olympus_Mons',
    'UTC',
    'Etc/GMT+3',
  ])('routes the unenumerated zone %s to the app stores instead of checkout', (zone) => {
    setAccountZone(zone);
    renderPage();
    expect(queryPlanControls()).toHaveLength(0);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Subscribe in the CircleCare app' })
    ).toBeInTheDocument();
  });

  // ── NOT KNOWING IS A THIRD STATE ─────────────────────────────────────────

  // An optimistic first paint would not be a hard gate: a live Subscribe
  // button for the few hundred ms of a cold `/users/me` read is a live
  // Subscribe button in front of exactly the user being routed away.
  it('renders neither the paywall nor the store card while the account row is still loading', () => {
    setAccountPending();
    renderPage();
    expect(queryPlanControls()).toHaveLength(0);
    expect(screen.queryByText('Subscribe in the CircleCare app')).toBeNull();
    expect(screen.queryByText("We couldn't load your account")).toBeNull();
  });

  // A failed read is a network condition, not a foreign buyer. Telling a
  // Denver user to go buy on their phone because their request timed out is a
  // bad outcome and also simply false.
  it('shows a retryable error — NOT the store card — when the account read fails', () => {
    setAccountUnresolved();
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: "We couldn't load your account" })
    ).toBeInTheDocument();
    expect(screen.queryByText('Subscribe in the CircleCare app')).toBeNull();
    expect(screen.queryByRole('link', { name: /App Store/i })).toBeNull();
    // Still not a checkout: failing closed means no Subscribe here either.
    expect(queryPlanControls()).toHaveLength(0);
  });

  it('announces the failure and re-runs the read from the retry button', () => {
    setAccountUnresolved();
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load your account");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetchCountry).toHaveBeenCalledTimes(1);
  });

  it('still lets a user leave the page when the account read fails', () => {
    setAccountUnresolved();
    renderPage();
    expect(screen.getByRole('button', { name: 'Back to profile' })).toBeInTheDocument();
  });
});

// Type guard so the file is treated as a module under isolatedModules.
export type _ = ReactElement;
