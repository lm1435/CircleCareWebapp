import {
  Purchases,
  PurchasesError,
  ErrorCode,
  type Offering,
  type Package,
  type PurchaseResult,
} from '@revenuecat/purchases-js';
import { env } from './env';

/**
 * RevenueCat Web Billing (purchases-js) wrapper.
 *
 * Web purchases mirror mobile 1:1: the RevenueCat app user id MUST be the
 * Supabase `user.id` — identical to mobile's `Purchases.logIn(user.id)` — so a
 * web purchase unifies the cross-platform `CircleCare Premium` entitlement and
 * the EXISTING `/webhooks/revenuecat` handler maps the event to `users.id`
 * (which then flips `users.plan_tier`). The web client never grants the
 * entitlement itself; it only opens RevenueCat's hosted checkout.
 *
 * Configured from a PUBLIC billing key: the SANDBOX key (`rcb_sb_…`) runs
 * checkout in Stripe Test Mode (no real charge); the production build uses the
 * live key (`rcb_…`). When the key is unset the whole flow degrades silently.
 */

/** Entitlement identifier shared across platforms — must match the RevenueCat
 *  dashboard exactly. Activating it is what flips `plan_tier` to premium. */
export const PREMIUM_ENTITLEMENT = 'CircleCare Premium';

/**
 * Offering identifier for Web Billing. The `web` offering is intentionally NOT
 * the dashboard's current/default (mobile keeps that), so we resolve it by id
 * rather than relying on `offerings.current`.
 */
export const WEB_OFFERING_ID = 'web';

/** True when the web billing key is configured. When false the Upgrade CTA and
 *  /upgrade page are hidden (free users still see the in-app upgrade pointer). */
export function isWebBillingConfigured(): boolean {
  return Boolean(env.VITE_REVENUECAT_WEB_BILLING_KEY);
}

// The SDK forbids more than one configured instance, so we keep the singleton
// and only switch identities when the logged-in user changes.
let configuredUserId: string | null = null;

/**
 * Returns the singleton Purchases instance configured for `userId`
 * (the Supabase user id). Configures on first use; switches identity if a
 * different user logs in within the same tab.
 */
export function getPurchases(userId: string): Purchases {
  const apiKey = env.VITE_REVENUECAT_WEB_BILLING_KEY;
  if (!apiKey) {
    throw new Error('Web billing is not configured');
  }
  if (!Purchases.isConfigured()) {
    configuredUserId = userId;
    return Purchases.configure({ apiKey, appUserId: userId });
  }
  const instance = Purchases.getSharedInstance();
  if (configuredUserId !== userId) {
    configuredUserId = userId;
    void instance.changeUser(userId);
  }
  return instance;
}

/** Test seam — reset the cached identity so unit tests start clean. */
export function resetConfiguredUser(): void {
  configuredUserId = null;
}

/** Resolve the `web` offering (fallback to current) for this user. */
export async function getWebOffering(userId: string): Promise<Offering> {
  const offerings = await getPurchases(userId).getOfferings();
  const offering = offerings.all[WEB_OFFERING_ID] ?? offerings.current;
  if (!offering) {
    throw new Error('No web offering available');
  }
  return offering;
}

/** A purchasable plan, flattened for the UI. */
export interface WebPlan {
  /** The RevenueCat package to hand to `purchasePackage`. */
  rcPackage: Package;
  /** Package identifier ($rc_monthly | $rc_annual). */
  identifier: string;
  /** Localized, currency-formatted price string straight from Stripe (e.g. "$6.99"). */
  formattedPrice: string;
  /** Raw price in micro-units (9_990_000 = 9.99) — for savings/per-month math. */
  priceMicros: number;
  /** ISO 4217 currency code (e.g. "USD") for formatting derived amounts. */
  currency: string;
  /** True when the product carries a free-trial intro phase. */
  hasFreeTrial: boolean;
}

/** Flatten a RevenueCat package into a {@link WebPlan} for rendering. */
export function toWebPlan(pkg: Package): WebPlan {
  const product = pkg.webBillingProduct;
  return {
    rcPackage: pkg,
    identifier: pkg.identifier,
    formattedPrice: product.price.formattedPrice,
    priceMicros: product.price.amountMicros,
    currency: product.price.currency,
    hasFreeTrial: product.freeTrialPhase != null,
  };
}

/** Open RevenueCat's hosted checkout for a package. Resolves once the purchase
 *  completes; rejects with a {@link PurchasesError} (user-cancel included). */
export async function purchasePackage(
  userId: string,
  pkg: Package,
  customerEmail?: string
): Promise<PurchaseResult> {
  return getPurchases(userId).purchase({ rcPackage: pkg, customerEmail });
}

/** Stripe/RevenueCat subscription-management URL for the user, if any. */
export async function getManagementUrl(userId: string): Promise<string | null> {
  const info = await getPurchases(userId).getCustomerInfo();
  return info.managementURL;
}

/** True when the error is the user dismissing the checkout (not a real failure). */
export function isUserCancelledError(error: unknown): boolean {
  return error instanceof PurchasesError && error.errorCode === ErrorCode.UserCancelledError;
}
