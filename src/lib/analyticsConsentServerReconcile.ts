import { getCurrentUser, type User } from '@/api/users';
import { getAnalyticsConsentState } from './analyticsConsent';
import { recordAnalyticsConsentDecision } from './analyticsConsentDecision';
import { hasQueuedAnalyticsConsent } from './analyticsConsentSync';
import { identifyUser } from './posthog';

/**
 * ── WHAT THE ACCOUNT SAYS, vs WHAT THIS BROWSER REMEMBERS ────────────────
 *
 * `lib/analyticsConsent.ts` keeps the answer in ONE key in ONE browser
 * (`cc_analytics_enabled`) and, until this module, nothing ever read the
 * server's copy. The server has had one all along: `analytics_consent_
 * withdrawn_at` / `analytics_consent_granted_at` are columns on the user row and
 * `GET /users/me` already returns both. `getCurrentUser` is an untyped
 * passthrough, so those fields have been arriving on every profile fetch and
 * being thrown away.
 *
 * THE FAILURE THAT FIXES. Someone withdraws consent on their phone's browser.
 * The backend stamps `withdrawn_at`, suppresses its own server-side capture and
 * DELETES their PostHog person. Their laptop's localStorage still says granted,
 * so the next page load runs `identifyUser` and re-creates that person — and
 * the one after that, and the one after that, forever, until somebody clears
 * that browser's site data. They were told their data was deleted.
 *
 * ── A RESTORE, NEVER A PUBLISH ───────────────────────────────────────────
 *
 * This must NEVER write back. No `syncAnalyticsConsent`, no
 * `queueAnalyticsConsentForSignup`, no touching `analyticsConsentSync`'s
 * pending marker. Two browsers that both wrote back would trade a
 * withdraw/restore pair on every page load and hammer the per-user rate
 * limiter — and, decisively, a reconcile that can write is a reconcile that can
 * propagate a WRONG local value onto the account, which is the opposite of what
 * it exists for. Local state is the only thing it changes.
 *
 * It does READ that marker (`hasQueuedAnalyticsConsent`), and must:
 *
 * ── AN UNDELIVERED LOCAL DECISION IS NEWER THAN THE SERVER ───────────────
 *
 * The server's stamps are the account's answer only as of the last decision
 * that REACHED it. When this browser holds a queued, undelivered decision for
 * this account, the server has by definition not heard it yet, so its copy is
 * the stale one. The failure this closes: someone turns analytics OFF in
 * Profile, the withdraw POST fails (offline, 5xx, a reload mid-flight), and on
 * the next load the reconcile read "server granted vs local declined", wrote
 * GRANTED and identified them — overriding an explicit withdrawal for a session
 * — after which the flush delivered the withdrawal and the load after that
 * flipped back. The grant direction is symmetric.
 *
 * So a queued entry for this account means HANDS OFF: the local answer stands,
 * `identifyUser` (which re-reads the mode) follows it, and the flush carries it
 * to the server. The check is made TWICE — snapshotted BEFORE the server read
 * and repeated at decision time — so it holds whichever order the read and a
 * concurrent flush resolve in (`signIn` runs them side by side: a flush that
 * lands and clears the entry before a stale read returns must not reopen the
 * override), and so a Profile toggle made while the read is on the wire is not
 * overwritten by the answer to a question asked before it.
 *
 * ── ONLY FOR THE SESSION THAT ASKED ──────────────────────────────────────
 *
 * The server read is async and sign-out is not gated on it. A reconcile whose
 * `/users/me` resolves after sign-out has finished — `resetAnalytics()` already
 * run — must neither record a decision (claimed for an account that has left)
 * nor identify (re-attaching the departed account, so the next visitor on a
 * shared browser is recorded as them). The caller passes `isCurrentSession`,
 * a check bound to the sign-in that started this reconcile; it is consulted
 * before either effect. A callback, not an import of the auth store, which
 * imports this module.
 *
 * ── BOTH DIRECTIONS, AND WHY THAT IS NOT A GRANDFATHERING CHANGE ─────────
 *
 * Server 'granted' + local declined/unasked → GRANT.
 * Server 'declined' + local granted        → WITHDRAW.
 *
 * Both are the account holder's OWN explicit answer, given on some surface of
 * this product, being carried to a browser that never heard it. Neither invents
 * consent for anyone: the grant direction only fires when the account itself
 * carries a `granted_at` stamp.
 *
 * `'unasked'` ON THE SERVER CHANGES NOTHING LOCALLY. That is
 * `GRANDFATHER_UNASKED_WEB_USERS = false` (lib/analyticsMode.ts) staying
 * intact — an account with no recorded answer is not evidence of an answer in
 * either direction, and treating it as a grant is precisely the thing that
 * constant forbids. It is also why the comparison below is on
 * "granted / not-granted" rather than on the tri-state: a server 'declined'
 * meeting a local 'unasked' would otherwise write 'declined' into storage on an
 * auth path, changing nothing observable (both resolve to the same anonymous
 * mode) at the cost of a write the auth path has no reason to make.
 *
 * ── TWO COMPLICATIONS MOBILE DOES NOT HAVE ───────────────────────────────
 *
 * (a) OWNERSHIP. `setAnalyticsConsent` deliberately leaves a new answer
 *     OWNERLESS (lib/analyticsConsent.ts), and an ownerless answer is ADOPTED
 *     by the next account to sign in on this browser. A reconciled write is by
 *     definition one account's answer, so it must be claimed. It is — this
 *     module goes through `recordAnalyticsConsentDecision(accepted, { id })`,
 *     which stamps the owner immediately after the write.
 *
 * (b) ORDERING. `identifyUser` is synchronous and the server read is not, so on
 *     the withdrawn path the first `$identify` of the page load would go out
 *     before the reconcile landed — re-creating the very person the withdrawal
 *     deleted. `identifyAfterServerReconcile` below is the fix, and both auth
 *     paths use it instead of calling `identifyUser` themselves.
 *
 * Ported from mobile/src/services/analyticsConsentServerReconcile.ts.
 */

/**
 * What the ACCOUNT says about analytics consent, as opposed to what this
 * browser remembers.
 *
 * `unknown` and `unasked` are deliberately distinct and both mean "change
 * nothing" — see {@link deriveServerConsent} for why collapsing them is the bug.
 */
export type ServerConsentDecision = 'granted' | 'declined' | 'unasked' | 'unknown';

const ALWAYS_CURRENT = (): boolean => true;

/**
 * `hasQueuedAnalyticsConsent`, made unable to throw. The real read already
 * swallows storage failures; this keeps the reconcile's never-throws contract
 * from depending on that. An unreadable queue reads as "nothing queued", which
 * is exactly the behaviour before the queue was consulted at all — and, on the
 * WITHDRAW direction, the privacy-protective one.
 */
function queuedFor(userId: string): boolean {
  try {
    return hasQueuedAnalyticsConsent(userId) === true;
  } catch {
    return false;
  }
}

/**
 * Read the account's decision out of a profile.
 *
 * `=== undefined`, NEVER falsy. This is the same distinction
 * `utils/hourCycle.ts` makes at `uses_24h_clock === true` / `=== false` (lines
 * 163-164), and it is load-bearing for the same reason: the client does not
 * ship in lockstep with the backend.
 *
 *   - UNDEFINED means the backend has no such column and CANNOT answer. A falsy
 *     check reads that as "no decision"; a `!== null` check reads it as "there
 *     is a stamp". Both are wrong, and either one lets a stale backend overwrite
 *     a real, explicit decision on every page load — permanently, since that
 *     backend can never stamp anything to close the branch again.
 *   - NULL means the backend answered and there is no stamp.
 *
 * Do NOT copy the `Boolean(user.email_digest_enabled)` shape at
 * ProfilePage.tsx:619 here: that field's missing/false collapse is harmless,
 * this one's is not.
 *
 * Order matters: WITHDRAWN WINS. A user who granted and later withdrew has both
 * stamps, and the withdrawal is the more recent statement of intent — and the
 * safer one to honour if the pair is ever ambiguous.
 */
export function deriveServerConsent(user: Partial<User>): ServerConsentDecision {
  if (
    user.analytics_consent_withdrawn_at === undefined ||
    user.analytics_consent_granted_at === undefined
  ) {
    return 'unknown';
  }
  if (user.analytics_consent_withdrawn_at !== null) return 'declined';
  if (user.analytics_consent_granted_at !== null) return 'granted';
  return 'unasked';
}

/**
 * Restore this browser's analytics consent from the account's own record.
 *
 * NEVER THROWS. Both call sites sit on an authenticated entry path — a restored
 * cookie session and a fresh sign-in — and a consent failure must not be able to
 * break either. `bootstrap` in particular reads a throw from anywhere inside its
 * try block as "no session" and signs the user out.
 *
 * @param userId  the account this reconcile is for — used to CLAIM the answer
 *                (see the ownership note above), never sent anywhere.
 * @param profile the round trip the caller already made. `bootstrap` has the
 *                `/users/me` document in hand, so passing it makes this cost no
 *                extra request. Fetching for ourselves when nobody supplies one
 *                keeps this callable from `signIn`, which has no profile (auth
 *                responses carry only id/email/first_name/last_name).
 * @param isCurrentSession true while the sign-in that started this reconcile
 *                is still the live one. Checked before any decision is
 *                recorded. Defaults to always-true for callers with no session
 *                lifecycle of their own.
 */
export async function reconcileAnalyticsConsentFromServer(
  userId: string,
  profile?: Promise<User> | User,
  isCurrentSession: () => boolean = ALWAYS_CURRENT
): Promise<void> {
  try {
    // SNAPSHOT BEFORE THE READ. Synchronous, so it is taken before this call
    // yields — and therefore before any flush started alongside it can have
    // delivered and cleared the entry. See "AN UNDELIVERED LOCAL DECISION IS
    // NEWER THAN THE SERVER" above.
    const queuedBeforeRead = queuedFor(userId);

    let user: User;
    try {
      user = await (profile ?? getCurrentUser());
    } catch {
      // Offline, a 5xx, an expired token — nothing to reconcile against. The
      // browser keeps whatever answer it holds, which is the conservative
      // outcome: this function only ever REPAIRS a browser, it is not a gate.
      return;
    }

    const decision = deriveServerConsent(user);
    // 'unknown' = the backend cannot answer. 'unasked' = it answered and there
    // is no decision. Neither is evidence of anything; both change nothing.
    if (decision === 'unknown' || decision === 'unasked') return;

    // AGREEMENT IS THE NORMAL CASE, AND IT MUST COST NOTHING. This runs on
    // every authenticated entry, and `setAnalyticsConsent` notifies every
    // subscriber; writing the value the browser already holds would re-announce
    // it — and re-render whatever listens — on every single page load.
    //
    // Compared as granted / not-granted rather than as the tri-state, on
    // purpose: see the `'unasked'` note in this module's header.
    const serverGranted = decision === 'granted';
    const localGranted = getAnalyticsConsentState() === 'granted';
    if (localGranted === serverGranted) return;

    // A LOCAL DECISION THE SERVER HAS NOT HEARD YET WINS. Queued before the
    // read, or queued while it was in flight — either way the server's answer
    // predates it. Nothing is written; the flush delivers the local answer.
    if (queuedBeforeRead || queuedFor(userId)) return;

    // The sign-in that asked has ended (or been superseded) while the read was
    // on the wire. Recording now would claim an answer for an account that is
    // no longer here, and on a grant would re-identify it after sign-out's
    // `resetAnalytics()`.
    if (!isCurrentSession()) return;

    // THROUGH `recordAnalyticsConsentDecision`, not around it. That module is
    // the one place a consent answer becomes client state, and it owns the
    // whole sequence: tear down BEFORE persisting on a withdrawal (so posthog's
    // batched queue — the one built up right before the account said stop — is
    // dropped rather than transmitted), persist, claim the answer for this
    // account, and on an acceptance re-init and re-identify. Reimplementing any
    // of that here is how the two surfaces drift, silently, in a different
    // direction per step.
    //
    // It also handles the case where the teardown itself throws: it does not,
    // because the withdrawal write must land regardless — see its own note.
    recordAnalyticsConsentDecision(serverGranted, { id: userId });
  } catch {
    // Belt and braces. Nothing above is expected to throw — the storage helpers
    // all swallow — but this function's contract with the auth store is that it
    // CANNOT, and a contract that depends on auditing three other modules is
    // not a contract.
  }
}

/**
 * Reconcile the account's recorded answer FIRST, then identify.
 *
 * THE ORDERING FIX (complication (b) above), and the only thing either auth
 * path should call. `identifyUser` is synchronous; the server read is not. Left
 * in the order the auth store used, a browser whose localStorage still says
 * granted sends `$identify` for an account that has WITHDRAWN — re-creating the
 * PostHog person the withdrawal deleted — and only then discovers it should not
 * have. Once per page load, forever.
 *
 * Deferring costs nothing real. posthog-js's `$identify` merges the anonymous
 * `distinct_id` into the person, so events captured in the window before it
 * lands are not orphaned; and when the reconcile decides 'granted', it has
 * already re-identified through `recordAnalyticsConsentDecision` before this
 * line runs.
 *
 * Never throws, for the same reason as the function above.
 */
export async function identifyAfterServerReconcile(
  userId: string,
  profile?: Promise<User> | User,
  isCurrentSession: () => boolean = ALWAYS_CURRENT
): Promise<void> {
  await reconcileAnalyticsConsentFromServer(userId, profile, isCurrentSession);
  try {
    // SIGN-OUT MAY HAVE FINISHED DURING THE AWAIT ABOVE. Its `resetAnalytics()`
    // has already dropped the identity; identifying now would re-attach the
    // account that just left, and on a shared browser the next visitor's
    // events would land on that person.
    if (!isCurrentSession()) return;
    // `identifyUser` re-reads the mode itself (`identifyAllowed`), so on the
    // withdrawn path — where the reconcile has just written 'declined' — this
    // is now correctly REFUSED rather than raced. Likewise when the reconcile
    // stood aside for a queued local decision: the identify follows THAT.
    identifyUser(userId);
  } catch {
    /* best-effort: analytics must never break a sign-in */
  }
}
