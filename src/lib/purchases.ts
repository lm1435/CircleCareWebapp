import { env } from './env';
import { isWebBillingConfigured } from './webBillingConfig';

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
 *
 * BUNDLE NOTE: `@revenuecat/purchases-js` is ~177 KB gzip and is only needed on
 * the /upgrade page and the profile "Manage subscription" action. This module
 * therefore never STATICALLY imports it — every function below that touches
 * the SDK loads it with `await import(...)`, so it lands in its own chunk and
 * is fetched only when a purchase flow is actually reached. The pure env
 * predicate that used to live here (`isWebBillingConfigured`) moved to
 * `./webBillingConfig` — re-exported below for existing callers — because it
 * has nothing to do with the SDK and four non-purchase modules only ever
 * needed the boolean.
 */
export { isWebBillingConfigured };

/** Entitlement identifier shared across platforms — must match the RevenueCat
 *  dashboard exactly. Activating it is what flips `plan_tier` to premium. */
export const PREMIUM_ENTITLEMENT = 'CircleCare Premium';

/**
 * Offering identifier for Web Billing. The `web` offering is intentionally NOT
 * the dashboard's current/default (mobile keeps that), so we resolve it by id
 * rather than relying on `offerings.current`.
 */
export const WEB_OFFERING_ID = 'web';

// Type-only references into the SDK's public surface. `import('pkg').Type`
// used as a TYPE POSITION is erased entirely at compile time — it emits no
// runtime `import`/`require` of '@revenuecat/purchases-js' — which is what
// keeps this file free of any static dependency on the SDK.
type PurchasesModule = typeof import('@revenuecat/purchases-js');
type PurchasesInstance = import('@revenuecat/purchases-js').Purchases;
type Offering = import('@revenuecat/purchases-js').Offering;
type Package = import('@revenuecat/purchases-js').Package;
type PurchaseResult = import('@revenuecat/purchases-js').PurchaseResult;

// Cached dynamic-import promise so repeated calls share one fetch, plus a
// synchronous snapshot of the resolved module for `isUserCancelledError`
// (which must stay synchronous — see its doc comment).
let sdkPromise: Promise<PurchasesModule> | null = null;
let loadedSdk: PurchasesModule | null = null;

function loadSdk(): Promise<PurchasesModule> {
  if (!sdkPromise) {
    sdkPromise = import('@revenuecat/purchases-js')
      .then((mod) => {
        loadedSdk = mod;
        return mod;
      })
      .catch((err: unknown) => {
        // A REJECTED import (chunk 404 after a redeploy, offline, a flaky
        // CDN) must not be cached forever — without clearing `sdkPromise` on
        // failure, every future purchase attempt in this tab would replay the
        // SAME rejection until a full page reload, permanently bricking
        // checkout for the rest of the session.
        sdkPromise = null;
        throw err;
      });
  }
  return sdkPromise;
}

// The SDK forbids more than one configured instance, so we keep the singleton
// and only switch identities when the logged-in user changes.
let configuredUserId: string | null = null;

/**
 * Returns the singleton Purchases instance configured for `userId`
 * (the Supabase user id). Loads the SDK (once, shared across calls) and
 * configures on first use; switches identity if a different user logs in
 * within the same tab.
 *
 * Async (unlike the old synchronous version) because loading the SDK is
 * itself async — every exported caller here (`getWebOffering`,
 * `purchasePackage`, `getManagementUrl`) already awaits it, so nothing outside
 * this module observes a behavior change beyond the added microtask.
 */
export async function getPurchases(userId: string): Promise<PurchasesInstance> {
  const apiKey = env.VITE_REVENUECAT_WEB_BILLING_KEY;
  if (!apiKey) {
    throw new Error('Web billing is not configured');
  }
  const { Purchases } = await loadSdk();
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
  /** Trial length from the store's own offer (e.g. {number: 7, unit: 'day'}),
   *  or null when no trial. Surfaced so the paywall states the DURATION —
   *  "free trial" with no length is the pattern FTC/Play enforcement targets. */
  trialPeriod: { number: number; unit: string } | null;
}

/** Resolve the `web` offering (fallback to current) for this user. */
export async function getWebOffering(userId: string): Promise<Offering> {
  const purchases = await getPurchases(userId);
  const offerings = await purchases.getOfferings();
  const offering = offerings.all[WEB_OFFERING_ID] ?? offerings.current;
  if (!offering) {
    throw new Error('No web offering available');
  }
  return offering;
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
    trialPeriod: product.freeTrialPhase?.period
      ? { number: product.freeTrialPhase.period.number, unit: product.freeTrialPhase.period.unit }
      : null,
  };
}

/** Open RevenueCat's hosted checkout for a package. Resolves once the purchase
 *  completes; rejects with a {@link PurchasesError} (user-cancel included). */
export async function purchasePackage(
  userId: string,
  pkg: Package,
  customerEmail?: string
): Promise<PurchaseResult> {
  const purchases = await getPurchases(userId);
  return purchases.purchase({ rcPackage: pkg, customerEmail });
}

/** Stripe/RevenueCat subscription-management URL for the user, if any. */
export async function getManagementUrl(userId: string): Promise<string | null> {
  const purchases = await getPurchases(userId);
  const info = await purchases.getCustomerInfo();
  return info.managementURL;
}

/**
 * True when the error is the user dismissing the checkout (not a real
 * failure). Kept SYNCHRONOUS by design — the two call sites (UpgradePage's
 * purchase `onError`) need an immediate boolean, and by the time a real
 * RevenueCat error can reach either of them `purchasePackage` has already
 * awaited `loadSdk()`, so `loadedSdk` is guaranteed populated. If the SDK
 * somehow never loaded, this safely reports "not a cancel" rather than
 * throwing.
 */
export function isUserCancelledError(error: unknown): boolean {
  if (!loadedSdk) return false;
  return (
    error instanceof loadedSdk.PurchasesError &&
    error.errorCode === loadedSdk.ErrorCode.UserCancelledError
  );
}
