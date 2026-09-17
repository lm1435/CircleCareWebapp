import {
  getAnalyticsConsentState,
  setAnalyticsConsent,
  setAnalyticsConsentOwner,
} from './analyticsConsent';
import { disableAnalytics, identifyUser, initAnalytics } from './posthog';

/**
 * The ONE place a consent answer becomes client state.
 *
 * Every surface that can record an answer goes through this — the signup
 * checkbox (pages/SignUpPage.tsx, and pages/AuthCallbackPage.tsx for the OAuth
 * half) and the Profile > Privacy toggle — so the teardown / re-init /
 * re-identify sequence cannot drift between them. Each step is silent when it
 * is missed, in a different direction:
 *
 *   - skip the teardown on a withdrawal, and posthog's batched queue — the one
 *     built up right before someone said stop — is transmitted anyway;
 *   - skip the re-init on an acceptance, and the client keeps running in
 *     whatever mode it booted in while the UI reads ON;
 *   - skip the re-identify, and everything after the acceptance stays attached
 *     to the anonymous id, so consenting bought nothing.
 *
 * Deliberately NOT in lib/analyticsConsent.ts: that module is a leaf that
 * lib/analyticsMode and therefore lib/posthog sit on top of, and importing
 * posthog into it would cycle. This module sits ABOVE posthog instead.
 *
 * It handles the CLIENT half only. The server half (`analytics_consent_
 * withdrawn_at`, which suppresses server-side capture and deletes the PostHog
 * person) needs a user id and a retry marker and stays in
 * lib/analyticsConsentSync.ts, called by the surfaces that have a session.
 */
export function recordAnalyticsConsentDecision(
  accepted: boolean,
  // ID ONLY. This used to take `{ id, email }` and forward the email to
  // `identifyUser`. Nothing about a consent decision needs an address, and the
  // only thing accepting one buys is a second route by which one can reach
  // PostHog's person store — see `identifyUser`'s note in lib/posthog.ts.
  user?: { id: string }
): void {
  // TEAR DOWN BEFORE PERSISTING, and only when there is something to tear
  // down. `disableAnalytics` resolves the declined mode from the answer being
  // GIVEN, and the emit-path gate re-reads storage per event, so a withdrawal
  // has to drop the queue while the stored state still says granted.
  //
  // The `granted` check is what keeps a SIGNUP decline from calling it: at
  // that moment the visitor was 'unasked' — already on the anonymous client —
  // and `reset()` would drop the pending queue holding their own
  // `signup_started`. Deleting a funnel event to withdraw a consent that was
  // never given is pure loss.
  if (!accepted && getAnalyticsConsentState() === 'granted') {
    // A THROWN TEARDOWN MUST NOT SKIP THE WRITE BELOW. `disableAnalytics`
    // swallows its own posthog failures today, so this catch is currently
    // unreachable through it — but the guarantee belongs HERE, at the surface
    // every consent answer passes through, not in one implementation detail of
    // one collaborator. If the write is skipped the toggle keeps reading ON and
    // collection keeps running: the withdrawal silently does not happen, which
    // is the one outcome a withdrawal must never produce. Mobile's reconcile
    // states the same rule for the same reason.
    try {
      disableAnalytics();
    } catch {
      /* best-effort — the answer below is what actually stops collection */
    }
  }

  setAnalyticsConsent(accepted);

  // WHOSE ANSWER THIS IS, when we know. `setAnalyticsConsent` deliberately
  // leaves a new answer ownerless, so this stamp is what stops the next
  // account to sign in from adopting somebody else's decision — and what stops
  // a returning account from inheriting one. Both answers are stamped: a
  // decline is as much this person's answer as a grant, and an unowned decline
  // would be adopted by whoever signs in next just as readily.
  if (user?.id) setAnalyticsConsentOwner(user.id);

  if (!accepted) return;

  // Accepting mid-session has to (re)configure the client: in 'off' mode the
  // boot gate skipped it entirely, and in 'anonymous' mode it exists but was
  // never opted in. A repeat `init` is a no-op in posthog-js.
  initAnalytics();

  // …then re-attach the identity (BY ID — no person traits), when there is one
  // to attach. `identifyUser`
  // runs from the auth store on sign-in, which for a visitor who had not yet
  // consented was refused by the `identifyAllowed` gate — so without this,
  // everything after the acceptance stays on the anonymous id. Email/password
  // signup has no session yet (the backend returns an OTP, not a session), so
  // it passes no user and the auth store handles it at verify time instead.
  if (user?.id) identifyUser(user.id);
}
