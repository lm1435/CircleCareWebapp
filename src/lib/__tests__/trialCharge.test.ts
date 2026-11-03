/**
 * lib/trialCharge.ts (web port of mobile utils/trialCharge.ts): the exact
 * trial end + first charge, never an exact charge day for a store purchase.
 */
import i18n from '@/i18n';
import { PREMIUM_ENTITLEMENT } from '@/lib/purchases';
import {
  TRIAL_ENTITLEMENT_ID,
  formatTrialDate,
  trialChargeFrom,
  trialChargeNote,
  trialEndsLine,
  trialStartedMessage,
} from '@/lib/trialCharge';

const info = (over: Record<string, unknown> = {}) => ({
  entitlements: {
    active: {
      'CircleCare Premium': {
        periodType: 'trial',
        expirationDate: new Date('2026-11-10T18:00:00Z'),
        willRenew: true,
        store: 'rc_billing',
        productIdentifier: 'annual',
        ...over,
      },
    },
  },
});

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

it('reads the same entitlement as the purchase flow', () => {
  expect(TRIAL_ENTITLEMENT_ID).toBe(PREMIUM_ENTITLEMENT);
});

it('reads a trial from purchases-js CustomerInfo (Date instants, lowercase period type)', () => {
  expect(trialChargeFrom(info())).toEqual({
    endsAt: '2026-11-10T18:00:00.000Z',
    store: 'web',
    productIdentifier: 'annual',
  });
  expect(trialChargeFrom(info({ store: 'app_store' }))?.store).toBe('apple');
  expect(trialChargeFrom(info({ store: 'play_store' }))?.store).toBe('google');
});

it('is null when there is nothing to charge', () => {
  expect(trialChargeFrom(null)).toBeNull();
  expect(trialChargeFrom(info({ periodType: 'normal' }))).toBeNull();
  expect(trialChargeFrom(info({ expirationDate: null }))).toBeNull();
  expect(trialChargeFrom(info({ willRenew: false }))).toBeNull();
});

it('web (Stripe): the plain date and the localized price', () => {
  const charge = trialChargeFrom(info())!;
  const date = formatTrialDate(charge.endsAt, 'en', 'America/Denver');
  expect(trialStartedMessage(i18n.t, 'en', charge, '$59.99', 'America/Denver')).toBe(
    `Your free trial ends ${date}. You'll be charged $59.99 on ${date} unless you cancel before then.`
  );
});

it('a store trial names the store and the up-to-24-hours-early caveat, no exact charge day', () => {
  const charge = trialChargeFrom(info({ store: 'app_store' }))!;
  const note = trialChargeNote(i18n.t, 'en', charge, null, 'UTC');
  expect(note).toBe(
    "Unless you cancel, Apple will charge your plan's price when it ends. Apple can charge up to 24 hours early, so cancel at least a day before if you don't want to continue."
  );
});

it("the viewer's calendar, not UTC", () => {
  const charge = trialChargeFrom(info({ expirationDate: new Date('2026-11-10T03:00:00Z') }))!;
  expect(trialEndsLine(i18n.t, 'en', charge, 'America/Denver')).toMatch(/9/);
  expect(trialEndsLine(i18n.t, 'en', charge, 'UTC')).toMatch(/10/);
});

it('Latin American Spanish', async () => {
  await i18n.changeLanguage('es');
  const charge = trialChargeFrom(info())!;
  const msg = trialStartedMessage(i18n.t, 'es', charge, 'US$59.99', 'America/Mexico_City');
  expect(msg).toMatch(/^Tu prueba gratis termina el .+\. Se te cobrará US\$59\.99 el .+, a menos que canceles antes\.$/);
});
