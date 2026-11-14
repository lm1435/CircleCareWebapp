import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import i18n from '@/i18n';
import { ToastProvider } from '@/components/ui';

/**
 * THE COMPACT PAYWALL (1.4.2) — docs/plans/paywall-redesign-1-4-2.md §10.
 *
 * Test names carry the spec's case ids (P1..P11 positive, N1..N10 negative) so a
 * reviewer can map each one back to the spec. Every case that renders copy runs
 * in EN and ES. N4 (members never see a paywall) and N5 (the onboarding paywall
 * is shown once) are owned by their existing suites, named at the bottom.
 */

vi.mock('@/hooks/useWebBilling', () => ({
  useWebPlans: vi.fn(),
  usePurchasePlan: vi.fn(),
  useManageSubscription: vi.fn(),
}));
vi.mock('@/hooks/useSubscriptionStatus', () => ({ useSubscriptionStatus: vi.fn() }));
vi.mock('@/lib/purchases', () => ({ isUserCancelledError: vi.fn(() => false) }));
vi.mock('@/lib/webBillingConfig', () => ({ isWebBillingConfigured: vi.fn(() => true) }));
vi.mock('@/hooks/useAccountTimezone', () => ({
  useAccountTimezone: () => ({ timezone: 'America/New_York', isPending: false, refetch: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    planSelectionViewed: vi.fn(),
    planSelectionFreeSelected: vi.fn(),
    planSelectionSubscribed: vi.fn(),
    planSelectionTrialStarted: vi.fn(),
    planSelectionPurchaseCancelled: vi.fn(),
    planSelectionPlanChanged: vi.fn(),
    planSelectionDetailsToggled: vi.fn(),
    planSelectionCtaTapped: vi.fn(),
    planSelectionLegalOpened: vi.fn(),
    paywallDismissed: vi.fn(),
    paywallShown: vi.fn(),
    trialChargeNoticeShown: vi.fn(),
  },
}));

import { useWebPlans, usePurchasePlan, useManageSubscription } from '@/hooks/useWebBilling';
import { useSubscriptionStatus } from '@/hooks/useSubscriptionStatus';
import { Analytics } from '@/lib/analytics';
import { legalUrl } from '@/lib/legalLinks';
import UpgradePage from '@/pages/UpgradePage';

const mockedPlans = useWebPlans as unknown as ReturnType<typeof vi.fn>;
const mockedPurchase = usePurchasePlan as unknown as ReturnType<typeof vi.fn>;
const mockedManage = useManageSubscription as unknown as ReturnType<typeof vi.fn>;
const mockedStatus = useSubscriptionStatus as unknown as ReturnType<typeof vi.fn>;
const mutate = vi.fn();

function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rcPackage: {},
    identifier: '$rc_annual',
    formattedPrice: '$59.99',
    priceMicros: 59_990_000,
    currency: 'USD',
    hasFreeTrial: true,
    trialPeriod: { number: 7, unit: 'day' },
    ...overrides,
  };
}
const MONTHLY = plan({
  identifier: '$rc_monthly',
  formattedPrice: '$6.99',
  priceMicros: 6_990_000,
  hasFreeTrial: false,
  trialPeriod: null,
});

function setPlans(annual: Record<string, unknown> | null, monthly: Record<string, unknown> | null = MONTHLY): void {
  mockedPlans.mockReturnValue({ data: { annual, monthly }, isLoading: false, isError: false });
}

function renderAt(state: unknown): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/upgrade', state }]}>
      <ToastProvider>
        <Routes>
          <Route path="/upgrade" element={<UpgradePage />} />
          <Route path="/circles" element={<p data-testid="picker">picker</p>} />
          <Route path="/circles/:circleId" element={<p data-testid="today">today</p>} />
          <Route path="/profile" element={<p data-testid="profile">profile</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>
  );
}
const flushArming = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
beforeEach(() => {
  // The country gate's browser-zone signal: pinned so the sweep zones never send this
  // suite to the app-store card (UpgradePage.test.tsx owns the gate).
  Intl.DateTimeFormat.prototype.resolvedOptions = function resolvedOptions(this: Intl.DateTimeFormat) {
    return { ...realResolvedOptions.call(this), timeZone: 'America/New_York' };
  };
  vi.clearAllMocks();
  window.sessionStorage.clear();
  mockedStatus.mockReturnValue({ data: { tier: 'free' } });
  setPlans(plan());
  mockedPurchase.mockReturnValue({ mutate, isPending: false });
  mockedManage.mockReturnValue({ mutate: vi.fn(), isPending: false });
});
afterEach(async () => {
  Intl.DateTimeFormat.prototype.resolvedOptions = realResolvedOptions;
  await i18n.changeLanguage('en');
});

/** Per-language expectations for the rendered cases. */
const LANG = {
  en: {
    reasons: ['Unlimited caregivers', 'Care shifts', 'Up to 5 care circles'],
    details: [
      'Add by voice',
      'Managers and weekly care summary',
      'Adherence reports and calendar import',
      '1 GB of documents per circle',
      'Care assistant',
    ],
    seeAll: 'See everything included',
    showLess: 'Show less',
    trialCta: 'Start 7-day free trial',
    trialTerms:
      '7 days free, then $59.99 per year. Renews every year until you cancel in your account settings.',
    monthlyCta: 'Subscribe: $6.99/mo',
    monthlyTerms: '$6.99 per month. Renews every month until you cancel in your account settings.',
    annualNoTrialCta: 'Subscribe: $59.99/yr',
    free: /Continue with free plan/,
    close: 'Close',
    terms: 'Terms',
    privacy: 'Privacy',
    freeWord: /free|trial/i,
    featureHeadline: 'Get more from CircleCare.',
  },
  es: {
    reasons: ['Cuidadores ilimitados', 'Turnos de cuidado', 'Hasta 5 círculos de cuidado'],
    details: [
      'Agregar por voz',
      'Personas gestoras y resumen semanal',
      'Reportes de adherencia e importación de calendario',
      '1 GB de documentos por círculo',
      'Asistente de cuidado',
    ],
    seeAll: 'Ver todo lo que incluye',
    showLess: 'Ver menos',
    trialCta: 'Comenzar prueba gratis de 7 días',
    trialTerms:
      '7 días gratis; después $59.99 al año. Se renueva cada año hasta que canceles en la configuración de tu cuenta.',
    monthlyCta: 'Suscribirse: $6.99/mes',
    monthlyTerms: '$6.99 al mes. Se renueva cada mes hasta que canceles en la configuración de tu cuenta.',
    annualNoTrialCta: 'Suscribirse: $59.99/año',
    free: /Continuar con plan gratuito/,
    close: 'Cerrar',
    terms: 'Términos',
    privacy: 'Privacidad',
    freeWord: /gratis|prueba/i,
    featureHeadline: 'Aprovecha todo CircleCare.',
  },
} as const;

const rowTitles = (list: HTMLElement): string[] =>
  within(list)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('span')?.textContent ?? '');

/** Every value an analytics mock was called with must be an enum, a boolean or an integer. */
function expectOnlyEnumsBooleansIntegers(calls: unknown[][]): void {
  const flat = (v: unknown): unknown[] =>
    v && typeof v === 'object' ? Object.values(v as Record<string, unknown>).flatMap(flat) : [v];
  for (const value of calls.flat().flatMap(flat)) {
    if (typeof value === 'number') expect(Number.isInteger(value), `integer: ${value}`).toBe(true);
    else if (typeof value === 'string') expect(value, 'enum-like string').toMatch(/^[a-z_]+$/);
    else expect(typeof value).toBe('boolean');
  }
}

describe.each(['en', 'es'] as const)('compact paywall (%s)', (lng) => {
  const L = LANG[lng];
  beforeEach(async () => {
    await i18n.changeLanguage(lng);
  });

  it('P1_compact_default_shows_three_reasons_and_no_icons', () => {
    const { container } = renderAt({ paywallContext: 'onboarding' });
    const reasons = container.querySelector('[data-reasons]') as HTMLElement;
    expect(rowTitles(reasons)).toEqual(L.reasons);
    // Collapsed: the five detail rows are not in the document.
    expect(container.querySelector('[data-details]')).toBeNull();
    expect(screen.getByRole('button', { name: L.seeAll })).toHaveAttribute('aria-expanded', 'false');
    // Text only: no icon in any row, no trust strip.
    expect(reasons.querySelector('svg, img')).toBeNull();
    expect(container.textContent).not.toMatch(/Encrypted|Cifrado|Private by design|Privado por diseño/);
    // The only images are the decorative 22px logo (light + dark copies), hidden from AT.
    const imgs = Array.from(container.querySelectorAll('img'));
    expect(imgs.length).toBe(2);
    for (const img of imgs) {
      expect(img).toHaveAttribute('data-paywall-logo');
      expect(img).toHaveAttribute('alt', '');
      expect(img).toHaveAttribute('aria-hidden', 'true');
      expect(img).toHaveAttribute('width', '22');
    }
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('P2_details_expand_shows_five_more_rows_and_fires_event', async () => {
    const user = userEvent.setup();
    const { container } = renderAt({ paywallContext: 'onboarding' });
    const toggle = screen.getByRole('button', { name: L.seeAll });
    expect(toggle).toHaveAttribute('aria-controls', 'upgrade-details');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveTextContent(L.showLess);
    const details = container.querySelector('#upgrade-details [data-details]') as HTMLElement;
    expect(rowTitles(details)).toEqual(L.details);
    // In place: the details sit after the three reasons, before the footer.
    const reasons = container.querySelector('[data-reasons]') as HTMLElement;
    const footer = screen.getByTestId('upgrade-footer');
    expect(reasons.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(Analytics.planSelectionDetailsToggled).toHaveBeenCalledWith(true, 'onboarding', expect.any(Number));

    await user.click(screen.getByRole('button', { name: L.trialCta }));
    expect(Analytics.planSelectionCtaTapped).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'annual', paywallContext: 'onboarding', trialShown: true, detailsExpanded: true })
    );
    const toggled = (Analytics.planSelectionDetailsToggled as ReturnType<typeof vi.fn>).mock.calls;
    const tapped = (Analytics.planSelectionCtaTapped as ReturnType<typeof vi.fn>).mock.calls;
    // seconds are whole numbers once they reach the payload; here the raw value is passed
    // and analytics.ts rounds it (pinned in analytics.test.ts) — round it the same way.
    const asPayload = (c: unknown[][]): unknown[][] =>
      c.map((args) => args.map((a) => (typeof a === 'number' ? Math.round(a) : a)));
    expectOnlyEnumsBooleansIntegers(asPayload(toggled));
    expectOnlyEnumsBooleansIntegers(
      tapped.map(([a]) => [{ ...(a as object), secondsSinceView: Math.round((a as { secondsSinceView: number }).secondsSinceView) }])
    );
  });

  it('P3_annual_eligible_shows_trial_button_and_trial_terms_line', () => {
    renderAt({ paywallContext: 'onboarding' });
    const cta = screen.getByRole('button', { name: L.trialCta });
    expect(cta).toHaveTextContent('7');
    expect(screen.getByTestId('upgrade-terms')).toHaveTextContent(L.trialTerms);
    // Both state the store's length and the store's price.
    expect(screen.getByTestId('upgrade-terms').textContent).toContain('$59.99');
  });

  it('P4_monthly_shows_no_trial_and_monthly_terms_line', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'onboarding' });
    await user.click(screen.getByRole('radio', { name: lng === 'en' ? /^Monthly/ : /^Mensual/ }));
    expect(screen.getByRole('button', { name: L.monthlyCta })).toBeInTheDocument();
    const terms = screen.getByTestId('upgrade-terms');
    expect(terms).toHaveTextContent(L.monthlyTerms);
    expect(terms.textContent).not.toMatch(lng === 'en' ? /free|trial/i : /gratis|prueba/i);
    expect(Analytics.planSelectionPlanChanged).toHaveBeenCalledWith('monthly', 'onboarding');
  });

  it('P5_billed_amount_is_largest_price_text', () => {
    const { container } = renderAt({ paywallContext: 'onboarding' });
    const PX: Record<string, number> = { 'text-xs': 12, 'text-sm': 14, 'text-md': 16, 'text-base': 18, 'text-lg': 24, 'text-xl': 32 };
    const size = (el: Element): number => {
      const tok = el.className.split(/\s+/).find((c) => c in PX);
      return tok ? PX[tok] : 0;
    };
    const annual = container.querySelector('[data-plan-key="annual"]') as HTMLElement;
    const price = annual.querySelector('[data-price]') as HTMLElement;
    const perMonth = annual.querySelector('[data-per-month]') as HTMLElement;
    expect(price.textContent).toBe('$59.99');
    expect(perMonth.textContent).toContain('$5.00');
    expect(size(price)).toBe(32);
    expect(size(price)).toBeGreaterThan(size(perMonth));
  });

  it('P7_continue_free_dismisses_once_and_fires_free_selected_and_dismissed_with_method', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'onboarding' });
    await flushArming();
    await user.click(screen.getByRole('button', { name: L.free }));
    await screen.findByTestId('picker');
    expect(Analytics.planSelectionFreeSelected).toHaveBeenCalledTimes(1);
    expect(Analytics.paywallDismissed).toHaveBeenCalledTimes(1);
    expect(Analytics.paywallDismissed).toHaveBeenCalledWith('onboarding', {
      method: 'continue_free',
      secondsVisible: expect.any(Number),
      detailsExpanded: false,
      scrolled: false,
    });
    // A view always precedes its dismissal.
    const viewedOrder = (Analytics.planSelectionViewed as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    const dismissedOrder = (Analytics.paywallDismissed as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(viewedOrder).toBeLessThan(dismissedOrder);
  });

  it('P8_restore_terms_privacy_present_and_pressable', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'onboarding' });
    const footer = screen.getByTestId('upgrade-footer');
    const terms = within(footer).getByRole('link', { name: L.terms });
    const privacy = within(footer).getByRole('link', { name: L.privacy });
    expect(terms).toHaveAttribute('href', legalUrl('terms', lng));
    expect(privacy).toHaveAttribute('href', legalUrl('privacy', lng));
    // jsdom does not navigate; the click handler is what we assert.
    terms.addEventListener('click', (e) => e.preventDefault());
    privacy.addEventListener('click', (e) => e.preventDefault());
    await user.click(terms);
    await user.click(privacy);
    expect(Analytics.planSelectionLegalOpened).toHaveBeenNthCalledWith(1, 'terms');
    expect(Analytics.planSelectionLegalOpened).toHaveBeenNthCalledWith(2, 'privacy');
    // No Restore on the web: signing in is the restore (spec §8). Never a dead link.
    expect(screen.queryByRole('button', { name: /restore|restaurar/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /restore|restaurar/i })).toBeNull();
  });

  it('P9_care_assistant_row_matches_fact_sheet (rendered)', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'onboarding' });
    await user.click(screen.getByRole('button', { name: L.seeAll }));
    const row = document.querySelector('[data-benefit="ai"]') as HTMLElement;
    expect(row.textContent).toMatch(lng === 'en' ? /Answers questions/ : /Responde preguntas/);
    expect(row.textContent).toMatch(lng === 'en' ? /doesn't give medical advice/ : /no da consejos médicos/);
  });

  it('P10_owner_from_feature_gate_sees_compact_paywall_with_context_headline', () => {
    const { container } = renderAt({ paywallContext: 'feature' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(L.featureHeadline);
    expect(rowTitles(container.querySelector('[data-reasons]') as HTMLElement)).toEqual(L.reasons);
    expect(screen.getByRole('button', { name: L.seeAll })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: L.close })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: L.free })).toBeNull();
  });

  it('N1_trial_never_shown_while_eligibility_pending_or_ineligible', () => {
    // No trial on the offer, and a trial the store could not size: no trial words anywhere.
    for (const annual of [plan({ hasFreeTrial: false, trialPeriod: null }), plan({ trialPeriod: null })]) {
      setPlans(annual);
      const { unmount } = renderAt({ paywallContext: 'onboarding' });
      const card = screen.getByRole('radio', { name: lng === 'en' ? /^Annual/ : /^Anual/ });
      const cta = screen.getByRole('button', { name: L.annualNoTrialCta });
      const terms = screen.getByTestId('upgrade-terms');
      for (const el of [card, cta, terms]) expect(el.textContent).not.toMatch(L.freeWord);
      unmount();
    }
    expect(Analytics.planSelectionViewed).toHaveBeenCalledWith('onboarding', { trialShown: false, defaultPlan: 'annual' });
  });

  it('N6_no_free_button_outside_onboarding_context', () => {
    for (const ctx of ['general', 'capacity', 'invite_cap', 'feature', 'earned_meds', 'earned_invite', 'shifts']) {
      const { unmount } = renderAt({ paywallContext: ctx });
      expect(screen.queryByRole('button', { name: L.free })).toBeNull();
      unmount();
    }
  });

  it('N7_terms_line_not_inside_collapsed_details', () => {
    renderAt({ paywallContext: 'onboarding' });
    expect(screen.getByRole('button', { name: L.seeAll })).toHaveAttribute('aria-expanded', 'false');
    const terms = screen.getByTestId('upgrade-terms');
    expect(terms).toBeVisible();
    expect(terms.closest('#upgrade-details')).toBeNull();
    expect(terms.closest('[data-testid="upgrade-footer"]')).not.toBeNull();
  });

  it('N9_buy_button_disabled_until_price_loaded', async () => {
    setPlans(plan({ formattedPrice: '' }), null);
    renderAt({ paywallContext: 'onboarding' });
    const footer = screen.getByTestId('upgrade-footer');
    const buy = within(footer).getAllByRole('button')[0];
    expect(buy).toBeDisabled();
    buy.click();
    expect(mutate).not.toHaveBeenCalled();
    expect(Analytics.planSelectionCtaTapped).not.toHaveBeenCalled();
  });
});

describe('compact paywall footer', () => {
  it('P6_buy_and_free_buttons_visible_without_scrolling (structure; geometry in e2e/flows/upgrade-compact.spec.ts)', () => {
    renderAt({ paywallContext: 'onboarding' });
    const footer = screen.getByTestId('upgrade-footer');
    expect(within(footer).getByRole('button', { name: 'Start 7-day free trial' })).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: /Continue with free plan/ })).toBeInTheDocument();
    expect(footer.className.split(/\s+/)).toContain('pin-footer:sticky');
    expect(footer.className.split(/\s+/)).toContain('pin-footer:bottom-0');
  });

  it('N8_footer_does_not_cover_price_at_largest_text_size', () => {
    renderAt({ paywallContext: 'onboarding' });
    const cls = screen.getByTestId('upgrade-footer').className.split(/\s+/);
    // Never pinned unconditionally: only through the pin-footer variant...
    expect(cls).not.toContain('sticky');
    expect(cls).not.toContain('fixed');
    // ...which is a phone-width AND tall-enough media query, so a short viewport
    // (large zoom, landscape) gets the footer back in the flow.
    const globalsCss = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'styles', 'globals.css'),
      'utf8'
    );
    const decl = globalsCss.match(/@custom-variant pin-footer \(([^;]+)\);/);
    expect(decl?.[1]).toMatch(/max-width:\s*639\.98px/);
    expect(decl?.[1]).toMatch(/min-height:\s*600px/);
  });

  it('closes with the X and records method close, whole-page view first', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'capacity' });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await screen.findByTestId('profile');
    expect(Analytics.paywallDismissed).toHaveBeenCalledWith('capacity', expect.objectContaining({ method: 'close' }));
    expect(Analytics.planSelectionViewed).toHaveBeenCalledTimes(1);
  });

  it('plan_selection_plan_changed fires only on an actual change', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'general' });
    await user.click(screen.getByRole('radio', { name: /^Annual/ }));
    expect(Analytics.planSelectionPlanChanged).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: /^Monthly/ }));
    expect(Analytics.planSelectionPlanChanged).toHaveBeenCalledTimes(1);
    expect(Analytics.planSelectionPlanChanged).toHaveBeenCalledWith('monthly', 'general');
  });

  it('plan_selection_viewed reports trial_shown when the default plan shows a trial', () => {
    renderAt({ paywallContext: 'onboarding' });
    expect(Analytics.planSelectionViewed).toHaveBeenCalledTimes(1);
    expect(Analytics.planSelectionViewed).toHaveBeenCalledWith('onboarding', { trialShown: true, defaultPlan: 'annual' });
  });
});

// ── Locale files, every locale ────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_I18N = resolve(HERE, '..', '..', 'i18n');
const MOBILE_LOCALES = resolve(HERE, '..', '..', '..', '..', 'mobile', 'src', 'i18n', 'locales');
const ALL = ['en', 'es', 'de', 'fr', 'fr-CA', 'it', 'pt', 'pt-PT'] as const;
type Json = Record<string, unknown>;
const readJson = (p: string): Json => JSON.parse(readFileSync(p, 'utf8')) as Json;
const get = (o: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Json)[k] : undefined), o);
const base = (code: string): string | null => (code.includes('-') ? code.split('-')[0] : null);
/** A web upgrade.json value, resolved through the regional variant's base as i18next does. */
function web(code: string, path: string): unknown {
  const own = get(readJson(join(WEB_I18N, code, 'upgrade.json')), path);
  const b = base(code);
  return own ?? (b ? get(readJson(join(WEB_I18N, b, 'upgrade.json')), path) : undefined);
}
function mobile(code: string, key: string): unknown {
  const own = get(readJson(join(MOBILE_LOCALES, `${code}.json`)), `planSelection.${key}`);
  const b = base(code);
  return own ?? (b ? get(readJson(join(MOBILE_LOCALES, `${b}.json`)), `planSelection.${key}`) : undefined);
}
function strings(o: unknown, p = ''): Array<[string, string]> {
  if (typeof o === 'string') return [[p, o]];
  if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => strings(v, p ? `${p}.${k}` : k));
  return [];
}

const SHARED: Array<[string, string]> = [
  ['benefits.caregivers.title', 'featureCaregiversTitle'],
  ['benefits.caregivers.sub', 'featureCaregiversSub'],
  ['benefits.shifts.title', 'featureShiftsTitle'],
  ['benefits.shifts.sub', 'featureShiftsSub'],
  ['benefits.circles.title', 'featureCirclesTitle'],
  ['benefits.circles.sub', 'featureCirclesSub'],
  ['benefits.voice.title', 'featureVoiceTitle'],
  ['benefits.voice.sub', 'featureVoiceSub'],
  ['benefits.team.title', 'featureTeamTitle'],
  ['benefits.team.sub', 'featureTeamSub'],
  ['benefits.exports.title', 'featureExportsTitle'],
  ['benefits.exports.sub', 'featureExportsSub'],
  ['benefits.storage.title', 'featureStorageTitle'],
  ['benefits.storage.sub', 'featureStorageSub'],
  ['benefits.ai.title', 'featureAiTitle'],
  ['benefits.ai.sub', 'featureAiSub'],
  ['seeEverything', 'seeEverything'],
  ['showLess', 'showLess'],
  ['headlineOnboarding', 'headlineOnboarding'],
  ['eyebrow', 'eyebrow'],
  ['onboarding.continueFreeSub', 'freePlanSub'],
];

describe('compact paywall copy, every locale', () => {
  it.each(ALL)('P11_web_and_mobile_strings_match (%s)', (code) => {
    for (const [webPath, mobileKey] of SHARED) {
      const w = web(code, webPath);
      expect(w, `${code} web ${webPath}`).toBeTruthy();
      expect(w, `${code} web ${webPath} == mobile planSelection.${mobileKey}`).toBe(mobile(code, mobileKey));
    }
  });

  const ASSISTANT: Record<string, [RegExp, RegExp, string]> = {
    en: [/^Answers questions/, /doesn't give medical advice/, 'Care assistant'],
    es: [/^Responde preguntas/, /no da consejos médicos/, 'Asistente de cuidado'],
    de: [/^Beantwortet Fragen/, /keinen medizinischen Rat/, 'Pflegeassistent'],
    fr: [/^Répond aux questions/, /pas de conseils médicaux/, 'Assistant de soins'],
    'fr-CA': [/^Répond aux questions/, /pas de conseils médicaux/, 'Assistant de soins'],
    it: [/^Risponde a domande/, /non dà consigli medici/, 'Assistente di cura'],
    pt: [/^Responde a perguntas/, /não dá conselhos médicos/, 'Assistente de cuidado'],
    'pt-PT': [/^Responde a perguntas/, /não dá conselhos médicos/, 'Assistente de cuidado'],
  };
  it.each(ALL)('P9_care_assistant_row_matches_fact_sheet (%s)', (code) => {
    const [answers, noAdvice, name] = ASSISTANT[code];
    expect(web(code, 'benefits.ai.title')).toBe(name);
    expect(web(code, 'benefits.ai.sub')).toMatch(answers);
    expect(web(code, 'benefits.ai.sub')).toMatch(noAdvice);
  });

  const SUMMARIZES = /Summari[sz]es visits|Resume visitas|Fasst Besuche zusammen|Résume les visites|Riassume le visite|Resume consultas|surfaces what matters/i;
  it.each(ALL)('N3_summarizes_visits_claim_absent_in_all_locales (%s)', (code) => {
    const hits = strings(readJson(join(WEB_I18N, code, 'upgrade.json'))).filter(([, v]) => SUMMARIZES.test(v));
    expect(hits).toEqual([]);
  });

  const SUPPORTED_PHONES: Record<string, RegExp> = {
    en: /On supported phones\.$/,
    es: /En celulares compatibles\.$/,
    de: /Auf unterstützten Smartphones\.$/,
    fr: /Sur les téléphones compatibles\.$/,
    'fr-CA': /Sur les téléphones compatibles\.$/,
    it: /Sui telefoni compatibili\.$/,
    pt: /Em celulares compatíveis\.$/,
    'pt-PT': /Em telemóveis compatíveis\.$/,
  };
  it.each(ALL)('N10_voice_not_described_as_available_on_web (%s)', (code) => {
    expect(web(code, 'benefits.voice.sub')).toMatch(SUPPORTED_PHONES[code]);
  });

  // Currency symbols, ISO codes and anything shaped like an amount ("59.99", "5,00").
  const MONEY = /[$€£¥₹]|R\$|\b(USD|EUR|GBP|CAD|AUD|NZD|BRL|MXN|CHF)\b|\d+[.,]\d{2}\b/;
  it.each(readdirSync(WEB_I18N).filter((d) => ALL.includes(d as (typeof ALL)[number])))(
    'N2_no_hardcoded_price_or_currency_in_any_locale_string_or_event (%s upgrade.json)',
    (code) => {
      const hits = strings(readJson(join(WEB_I18N, code, 'upgrade.json'))).filter(([, v]) => MONEY.test(v));
      expect(hits).toEqual([]);
    }
  );

  it('N2_no_hardcoded_price_or_currency_in_any_locale_string_or_event (event payloads)', async () => {
    const user = userEvent.setup();
    renderAt({ paywallContext: 'onboarding' });
    await user.click(screen.getByRole('button', { name: 'See everything included' }));
    await user.click(screen.getByRole('radio', { name: /^Monthly/ }));
    await user.click(screen.getByRole('radio', { name: /^Annual/ }));
    await user.click(screen.getByRole('button', { name: 'Start 7-day free trial' }));
    const all = Object.values(Analytics).flatMap((fn) => (fn as ReturnType<typeof vi.fn>).mock.calls);
    expect(all.length).toBeGreaterThan(3);
    expect(JSON.stringify(all)).not.toMatch(MONEY);
  });
});

// N4_member_never_sees_paywall: a non-owner's premium CTA is a no-price toast on the web
//   (no paywall route, no list) — src/hooks/__tests__/usePremiumGate.test.tsx owns it.
// N5_onboarding_paywall_not_shown_twice: src/lib/__tests__/onboardingPaywall.test.ts owns it,
//   unchanged by this redesign.
