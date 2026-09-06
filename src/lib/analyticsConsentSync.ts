import { withdrawAnalyticsConsent, restoreAnalyticsConsent } from '@/api/users';

/**
 * Carries an analytics-consent decision to the server reliably.
 *
 * THE GAP THIS CLOSES. `ProfilePage.handleAnalyticsToggle` writes the local
 * consent flag and then fires `withdrawAnalyticsConsent()` /
 * `restoreAnalyticsConsent()` — both of which are DESIGNED to swallow their
 * own errors (see `api/users.ts`), because a privacy toggle must never show
 * an error banner. Without this module, a request that hits a network blip
 * (or a transient 5xx) just vanishes: the Privacy toggle reads OFF, but
 * `analytics_consent_withdrawn_at` never gets stamped, server-side capture
 * stays live, and nothing ever retries. That is silently the opposite of what
 * someone who explicitly declined was told would happen.
 *
 * Unlike mobile's `analyticsConsentSync.ts`, this module does NOT need
 * pre-auth/owner-handoff machinery: the toggle here lives on an authenticated
 * Profile page, so a session always exists at the moment a decision is made.
 * What it still needs is a USER ID on the marker. This app can be signed out
 * and back in as a DIFFERENT account in the same browser (no device-level
 * isolation the way a phone has), so a marker written by account A must never
 * be delivered under account B's session — that would stamp (or clear)
 * consent on the wrong account. `flushAnalyticsConsentSync` checks the id
 * before ever delivering.
 *
 * localStorage access is wrapped in try/catch throughout: it can throw in
 * private browsing on some browsers and under enterprise policies, and an
 * analytics preference must never be able to break the app.
 */

const PENDING_KEY = 'analytics_consent_pending_sync';

interface PendingConsent {
  enabled: boolean;
  userId: string;
  /**
   * Monotonically increasing id for the `syncAnalyticsConsent` call that wrote
   * this marker. A quick ON→OFF flip shares ONE key, so without this a later
   * decision's marker can be deleted by an EARLIER decision's success (e.g.
   * withdraw then restore: if restore lands first and succeeds, it must not
   * delete the still-pending withdraw's marker). A delivery only removes the
   * marker when the marker on disk is still the one IT wrote — see
   * `removePendingIfCurrent`.
   */
  seq: number;
}

function readPending(): PendingConsent | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as PendingConsent).enabled === 'boolean' &&
      typeof (parsed as PendingConsent).userId === 'string' &&
      typeof (parsed as PendingConsent).seq === 'number'
    ) {
      return parsed as PendingConsent;
    }
    return null;
  } catch {
    return null;
  }
}

function writePending(marker: PendingConsent): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(marker));
  } catch {
    // Best-effort: if this throws, delivery below still happens, it just
    // cannot be retried later on failure. Never let this break the toggle.
  }
}

function removePending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Best-effort — see writePending.
  }
}

/**
 * Remove the marker only if it is STILL the one a particular delivery wrote
 * (matched by `seq`). Guards against the interleaving above: a delivery that
 * succeeds after a newer decision has already overwritten the marker (or
 * after the marker was already cleared) must not delete that newer, possibly
 * still-undelivered, marker.
 */
function removePendingIfCurrent(seq: number): void {
  const current = readPending();
  if (current !== null && current.seq === seq) {
    removePending();
  }
}

/** Tail of the delivery chain — see syncAnalyticsConsent. */
let inFlight: Promise<void> = Promise.resolve();

/** Monotonically increasing id handed to each syncAnalyticsConsent call. */
let nextSeq = 0;

/** POST the decision to the server; true only if the server accepted it. */
async function deliver(enabled: boolean): Promise<boolean> {
  return enabled ? restoreAnalyticsConsent() : withdrawAnalyticsConsent();
}

/**
 * Record and deliver a consent decision made right now.
 *
 * Order matters: the marker is written FIRST (so a crash/reload mid-request
 * still leaves something to retry), delivery happens second, and the marker
 * is removed ONLY if delivery reports success AND the marker on disk still
 * carries THIS call's `seq` — see `removePendingIfCurrent`. Without the seq
 * check, a quick ON→OFF flip (restore then withdraw) could have the restore's
 * later success delete the withdraw's marker even though the withdraw itself
 * never reached the server, silently losing the user's actual, final decision.
 */
export async function syncAnalyticsConsent(enabled: boolean, userId: string): Promise<void> {
  const seq = ++nextSeq;
  writePending({ enabled, userId, seq });
  // SERIALISED. A quick off→on flip fires a withdraw and a restore back to
  // back; if the restore lands first the account ends up withdrawn while the
  // toggle reads ON. Chaining deliveries makes the server see them in the
  // order the user made them. The chain swallows failures so one bad request
  // cannot poison the next.
  const run = inFlight.then(async () => {
    const delivered = await deliver(enabled);
    if (delivered) removePendingIfCurrent(seq);
  });
  inFlight = run.catch(() => {});
  return run;
}

/**
 * Deliver any decision that never reached the server, called once a session
 * is confirmed (sign-in, or a restored bootstrap session).
 *
 * A decision belongs to the account that made it. If the marker's userId does
 * not match the signed-in user, it is a leftover from a DIFFERENT account
 * that previously used this browser (or that account is mid-sign-out on a
 * shared device) — leave it UNTOUCHED and return. Neither delivering it (it
 * was never this account's choice) nor deleting it (that account's own
 * sign-out flush, or a later sign-in of theirs, is what gets to retire it) is
 * safe to do on their behalf here.
 */
export async function flushAnalyticsConsentSync(userId: string): Promise<void> {
  const pending = readPending();
  if (pending === null) return;

  if (pending.userId !== userId) {
    return;
  }

  const delivered = await deliver(pending.enabled);
  if (delivered) removePendingIfCurrent(pending.seq);
}

/** Drop any pending decision. */
export async function clearAnalyticsConsentSync(): Promise<void> {
  removePending();
}
