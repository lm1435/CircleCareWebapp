import { scopedKey } from './storageScope';
import { toPaywallVariant, type PaywallVariant } from './paywallVariant';

/**
 * The first thing the person added during first-run setup, kept so the first-run paywall can lead
 * with what matters to them (lib/paywallVariant.ts). Per user (scopedKey) AND per circle. An enum,
 * never free text. localStorage, every touch wrapped: a storage failure is simply "no choice",
 * which reads as the default paywall. The key names a circle id, so sign-out clears the whole
 * `FIRST_RUN_CHOICE_PREFIX` family (authStore.clearLocalSession).
 */
export const FIRST_RUN_CHOICE_PREFIX = 'cc:firstRunChoice:';

export function firstRunChoiceKey(circleId: string): string {
  return scopedKey(`${FIRST_RUN_CHOICE_PREFIX}${circleId}`);
}

/** Record the first item type. Never throws. */
export function recordFirstRunChoice(circleId: string | null | undefined, action: string): void {
  if (!circleId) return;
  try {
    window.localStorage.setItem(firstRunChoiceKey(circleId), action);
  } catch {
    // Storage unavailable: the paywall falls back to the default.
  }
}

/** The paywall variant for this user and circle. Any miss, garbage or read failure is 'default'. */
export function readFirstRunVariant(circleId: string | null | undefined): PaywallVariant {
  if (!circleId) return 'default';
  try {
    return toPaywallVariant(window.localStorage.getItem(firstRunChoiceKey(circleId)));
  } catch {
    return 'default';
  }
}

/** Sign-out: drop every recorded choice (all users and circles in this browser). */
export function clearFirstRunChoices(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(FIRST_RUN_CHOICE_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Nothing to do.
  }
}
