import type { UpsellTrigger } from '@/api/subscriptionStatus';

/**
 * Cross-page state for the web earned upsell (mirror of mobile's
 * `hooks/earnedUpsellSession.ts`). Module scope on purpose: the ask is answered
 * on a DIFFERENT PAGE (`/upgrade`), and the "already asked" guard must outlive
 * `OverviewPage`, which remounts on every circle switch / Back.
 *
 * Keyed by USER ID rather than cleared at sign-out: a different account signing
 * in in the same tab is simply a different key, so there is no sign-out wiring
 * to forget and no way for account B to inherit account A's "already asked".
 */

/** The only paywall contexts the earned ask opens. Closing any other paywall
 *  says nothing about an earned trigger the user may never have been shown. */
const EARNED_CONTEXTS: readonly string[] = ['earned_meds', 'earned_invite'];

export function isEarnedPaywallContext(context: string | undefined): boolean {
  return context !== undefined && EARNED_CONTEXTS.includes(context);
}

export const EARNED_CONTEXT_BY_TRIGGER: Record<UpsellTrigger, 'earned_meds' | 'earned_invite'> = {
  meds_confirmed: 'earned_meds',
  invite_accepted: 'earned_invite',
};

export interface EarnedPaywallOutcomeHandlers {
  /** Closed without buying: writes the durable per-reason dismissal. */
  onDismissed: () => void;
  /** Tapped through to buy: must NEVER be treated as a dismissal. */
  onAccepted: () => void;
}

let presentedForUser: string | null = null;
let outcomeHandlers: EarnedPaywallOutcomeHandlers | null = null;

export function hasPresentedEarnedUpsellThisSession(userId: string): boolean {
  return presentedForUser === userId;
}

export function markEarnedUpsellPresented(
  userId: string,
  handlers: EarnedPaywallOutcomeHandlers
): void {
  presentedForUser = userId;
  outcomeHandlers = handlers;
}

/** One-shot: the page can emit its dismissal more than once; the durable write must not. */
export function notifyEarnedPaywallDismissed(context: string | undefined): void {
  if (!isEarnedPaywallContext(context)) return;
  const handlers = outcomeHandlers;
  outcomeHandlers = null;
  handlers?.onDismissed();
}

/** Deliberately leaves the handlers registered: a purchase the user then abandons
 *  is still a genuine dismissal when they close the page. */
export function notifyEarnedPaywallAccepted(context: string | undefined): void {
  if (!isEarnedPaywallContext(context)) return;
  outcomeHandlers?.onAccepted();
}

// Last decision REPORTED to analytics, so eligible/suppressed fire on a CHANGE,
// never per poll (per user, for the same reason as above).
let lastReportedFor: string | null = null;
let lastReportedEligibleTrigger: string | null = null;
let lastReportedSuppressedReason: string | null = null;

function scope(userId: string): void {
  if (lastReportedFor !== userId) {
    lastReportedFor = userId;
    lastReportedEligibleTrigger = null;
    lastReportedSuppressedReason = null;
  }
}

export function shouldReportUpsellEligible(userId: string, trigger: string): boolean {
  scope(userId);
  if (lastReportedEligibleTrigger === trigger) return false;
  lastReportedEligibleTrigger = trigger;
  lastReportedSuppressedReason = null;
  return true;
}

export function shouldReportUpsellSuppressed(userId: string, reason: string): boolean {
  scope(userId);
  if (lastReportedSuppressedReason === reason) return false;
  lastReportedSuppressedReason = reason;
  lastReportedEligibleTrigger = null;
  return true;
}

/** Test seam: back to the never-asked state. */
export function resetEarnedUpsellSession(): void {
  presentedForUser = null;
  outcomeHandlers = null;
  lastReportedFor = null;
  lastReportedEligibleTrigger = null;
  lastReportedSuppressedReason = null;
}
