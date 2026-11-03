import type { TFunction } from 'i18next';
import { normalizeLocale } from '@/i18n/locales';
import { getDeviceTimezone } from '@/utils/timezone';

/**
 * THE FIRST CHARGE AFTER A FREE TRIAL, STATED EXACTLY AND NEVER OVERCLAIMED.
 * Web port of mobile's utils/trialCharge.ts: same keys (common:trialCharge.*),
 * same rules.
 *
 * The date is RevenueCat's entitlement `expirationDate` (for a trial, the
 * trial's end) on the viewer's own calendar, never UTC. A STORE purchase
 * (Apple / Google Play) names the store as the one charging and says it can be
 * up to 24 hours early, because the stores bill ahead of the stated expiry
 * (memory: trial reminder charge timing, 2026-10-24). A web (Stripe) purchase
 * is charged at the trial end, so it gets the plain date.
 */

export type TrialStore = 'apple' | 'google' | 'web';

/**
 * Same value as lib/purchases PREMIUM_ENTITLEMENT (a test pins the two), kept
 * here so reading a trial never needs the purchases module.
 */
export const TRIAL_ENTITLEMENT_ID = 'CircleCare Premium';

export interface TrialCharge {
  endsAt: string;
  store: TrialStore;
  productIdentifier: string | null;
}

interface EntitlementLike {
  periodType?: string | null;
  expirationDate?: string | Date | null;
  willRenew?: boolean | null;
  store?: string | null;
  productIdentifier?: string | null;
}

interface CustomerInfoLike {
  entitlements?: { active?: Record<string, EntitlementLike | undefined> } | null;
}

function storeOf(raw: string | null | undefined): TrialStore {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'APP_STORE' || s === 'MAC_APP_STORE') return 'apple';
  if (s === 'PLAY_STORE') return 'google';
  return 'web';
}

/** The pending first charge, or null when there is none to state. */
export function trialChargeFrom(
  customerInfo: CustomerInfoLike | null | undefined,
  entitlementId: string = TRIAL_ENTITLEMENT_ID
): TrialCharge | null {
  const ent = customerInfo?.entitlements?.active?.[entitlementId];
  if (!ent) return null;
  if (String(ent.periodType ?? '').toUpperCase() !== 'TRIAL') return null;
  const end =
    ent.expirationDate instanceof Date ? ent.expirationDate.toISOString() : ent.expirationDate ?? null;
  if (!end || Number.isNaN(Date.parse(end))) return null;
  // Cancelled during the trial: nothing will be charged, so nothing may say so.
  if (ent.willRenew === false) return null;
  return { endsAt: end, store: storeOf(ent.store), productIdentifier: ent.productIdentifier ?? null };
}

function formattingLocale(language: string): string {
  const browserLocale = typeof navigator !== 'undefined' ? navigator.language : '';
  if (browserLocale && normalizeLocale(browserLocale) === normalizeLocale(language)) {
    return browserLocale;
  }
  return language;
}

/** "Nov 10, 2026" on the viewer's calendar (same shape as mobile's formatSubscriptionDate). */
export function formatTrialDate(
  instant: string,
  language: string,
  timeZone: string = getDeviceTimezone()
): string {
  return new Date(instant).toLocaleDateString(formattingLocale(language), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });
}

export function trialChargeNote(
  t: TFunction,
  language: string,
  charge: TrialCharge,
  price: string | null | undefined,
  timeZone?: string
): string {
  const date = formatTrialDate(charge.endsAt, language, timeZone);
  if (charge.store === 'web') {
    return price
      ? t('common:trialCharge.chargeNoteWeb', { price, date })
      : t('common:trialCharge.chargeNoteWebNoPrice', { date });
  }
  const store =
    charge.store === 'apple' ? t('common:trialCharge.storeApple') : t('common:trialCharge.storeGoogle');
  return price
    ? t('common:trialCharge.chargeNoteStore', { store, price })
    : t('common:trialCharge.chargeNoteStoreNoPrice', { store });
}

export function trialStartedMessage(
  t: TFunction,
  language: string,
  charge: TrialCharge,
  price: string | null | undefined,
  timeZone?: string
): string {
  const date = formatTrialDate(charge.endsAt, language, timeZone);
  return `${t('common:trialCharge.endsSentence', { date })} ${trialChargeNote(t, language, charge, price, timeZone)}`;
}

export function trialEndsLine(
  t: TFunction,
  language: string,
  charge: TrialCharge,
  timeZone?: string
): string {
  return t('common:trialCharge.profileEnds', { date: formatTrialDate(charge.endsAt, language, timeZone) });
}
