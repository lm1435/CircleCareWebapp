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

/**
 * ── ONE SLOT PER ACCOUNT, NOT ONE SLOT ─────────────────────────────────────
 *
 * This used to hold a single marker: `{ enabled, userId, seq }`. Any new
 * decision overwrote whatever was there, including a DIFFERENT account's
 * undelivered one, and the docstring justified that with "that account's own
 * next sign-in would not have delivered it either". That premise is circular —
 * before the overwrite the marker still carried A's id, so
 * `flushAnalyticsConsentSync(A)` is precisely what WOULD have delivered it.
 * The overwrite is what made the premise true.
 *
 * The failure it bought: A's Profile withdrawal fails on a blip; A signs out;
 * B signs up in the same browser; B's queue overwrites A's marker; A signs
 * back in and their explicit withdrawal is gone permanently — the column never
 * stamped, the PostHog person never deleted, the toggle reading OFF while
 * server-side capture continues.
 *
 * So the store is a MAP keyed by user id. One entry per account (a later
 * decision by the same account still replaces that account's earlier one —
 * their latest answer is the answer), capped so a shared kiosk browser cannot
 * grow it without bound, evicting the oldest entry first.
 *
 * The key and the empty-store representation are unchanged: absent means
 * nothing pending, and the store is REMOVED rather than left as `{}` so every
 * "is anything pending" check still reads `getItem(...) === null`.
 */
interface PendingConsent {
  enabled: boolean;
  /**
   * Identity of the WRITE that produced this entry — not a sequence number.
   *
   * A delivery removes the entry only if the entry on disk is still the one IT
   * wrote (see `removePendingIfCurrent`), which needs the writes to be
   * distinguishable. The previous design used a module-level counter, and a
   * module variable belongs to ONE TAB while this store is shared by all of
   * them: every tab started at 0, so two tabs' first decisions both carried
   * `seq: 1` and tab A's success deleted tab B's still-undelivered decision —
   * the exact loss the mechanism existed to prevent. A token that is unique per
   * WRITE rather than per tab-lifetime has no such collision.
   */
  token: string;
}

/** userId -> that account's single undelivered decision. */
type PendingConsentMap = Record<string, PendingConsent>;

/**
 * Cap on distinct accounts held at once. A pending entry only exists while a
 * delivery is failing, so more than a couple means a shared browser; the cap
 * keeps a kiosk from growing this key forever. Oldest written is evicted
 * first (object key order is insertion order for non-numeric keys).
 */
const MAX_PENDING_ACCOUNTS = 8;

let tokenCounter = 0;

/**
 * Unique per write. `Date.now()` orders them, the counter separates writes
 * inside one millisecond in THIS tab, and the random suffix separates tabs —
 * which is the part the old counter could not do. Not a security value: it
 * only has to be different from every other write's.
 */
function newToken(): string {
  tokenCounter += 1;
  return `${Date.now().toString(36)}-${tokenCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function isEntry(value: unknown): value is PendingConsent {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PendingConsent).enabled === 'boolean' &&
    typeof (value as PendingConsent).token === 'string'
  );
}

/**
 * Read the whole store, migrating the LEGACY single-marker shape on the fly.
 *
 * The old shape is live in real browsers (it shipped), and a build that could
 * not read it would silently drop an undelivered withdrawal on first load —
 * the same data loss this file exists to prevent, caused by the fix for it.
 * The migration is read-only: nothing is rewritten until something is actually
 * written, so a flush for a NON-matching account still leaves the bytes on
 * disk exactly as they were.
 *
 * The legacy entry's token is DERIVED from its seq, deterministically, so a
 * delivery that reads it and then removes-if-current still matches itself.
 */
function readPendingMap(): PendingConsentMap {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

    const legacy = parsed as { enabled?: unknown; userId?: unknown; seq?: unknown };
    if (typeof legacy.enabled === 'boolean' && typeof legacy.userId === 'string') {
      return {
        [legacy.userId]: { enabled: legacy.enabled, token: `legacy-${String(legacy.seq)}` },
      };
    }

    const map: PendingConsentMap = {};
    for (const [userId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (userId.length > 0 && isEntry(entry)) {
        map[userId] = { enabled: entry.enabled, token: entry.token };
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writePendingMap(map: PendingConsentMap): void {
  try {
    const ids = Object.keys(map);
    if (ids.length === 0) {
      localStorage.removeItem(PENDING_KEY);
      return;
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(map));
  } catch {
    // Best-effort: if this throws, delivery below still happens, it just
    // cannot be retried later on failure. Never let this break the toggle.
  }
}

/** This account's undelivered decision, if it has one. */
function readPendingFor(userId: string): PendingConsent | null {
  return readPendingMap()[userId] ?? null;
}

/**
 * Does THIS account hold a decision made on this browser that has not reached
 * the server yet?
 *
 * READ-ONLY, and scoped to one account. It exists for
 * `lib/analyticsConsentServerReconcile.ts`: an undelivered local decision is
 * NEWER than whatever `/users/me` reports (the server has, by definition, not
 * heard it), so the reconcile must not overwrite it with the server's stale
 * copy. Before this existed it did — a withdrawal whose POST failed was
 * reverted to granted on the next load and the user was identified, and the
 * flush that followed flipped the server the other way.
 *
 * Another account's entry is never evidence about this one (the store is keyed
 * by account for exactly that reason — see PendingConsent), and nothing here
 * delivers, rewrites or migrates the stored bytes.
 *
 * Never throws: `readPendingMap` swallows storage failures and reads them as
 * "nothing pending", which leaves the reconcile doing what it always did.
 */
export function hasQueuedAnalyticsConsent(userId: string): boolean {
  if (!userId) return false;
  return readPendingFor(userId) !== null;
}

/**
 * Record (or replace) THIS account's undelivered decision and return the token
 * that identifies the write. Other accounts' entries are preserved.
 */
function writePendingFor(userId: string, enabled: boolean): string {
  const map = readPendingMap();
  const token = newToken();
  // Delete first so a replaced entry moves to the END of the insertion order
  // — the eviction below drops the least recently written account.
  delete map[userId];
  map[userId] = { enabled, token };
  const ids = Object.keys(map);
  for (let i = 0; i < ids.length - MAX_PENDING_ACCOUNTS; i++) {
    delete map[ids[i]];
  }
  writePendingMap(map);
  return token;
}

function removePending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Best-effort — see writePendingMap.
  }
}

/**
 * Remove this account's entry only if it is STILL the one a particular
 * delivery wrote (matched by `token`). Guards the interleaving above: a
 * delivery that succeeds after a newer decision has already replaced the entry
 * (or after it was already cleared) must not delete that newer, possibly still
 * undelivered, decision — whether the newer one came from this tab or another.
 *
 * Other accounts' entries are never touched here.
 */
function removePendingIfCurrent(userId: string, token: string): void {
  const map = readPendingMap();
  if (map[userId]?.token !== token) return;
  delete map[userId];
  writePendingMap(map);
}

/** Tail of the delivery chain — see syncAnalyticsConsent. */
let inFlight: Promise<void> = Promise.resolve();

/** POST the decision to the server; true only if the server accepted it. */
async function deliver(enabled: boolean): Promise<boolean> {
  return enabled ? restoreAnalyticsConsent() : withdrawAnalyticsConsent();
}

/**
 * Record and deliver a consent decision made right now.
 *
 * Order matters: the marker is written FIRST (so a crash/reload mid-request
 * still leaves something to retry), delivery happens second, and the marker
 * is removed ONLY if delivery reports success AND the entry on disk is still
 * the one THIS call wrote — see `removePendingIfCurrent`. Without that check,
 * a quick ON→OFF flip (restore then withdraw) could have the restore's later
 * success delete the withdraw's entry even though the withdraw itself never
 * reached the server, silently losing the user's actual, final decision. The
 * same check is what stops another TAB's decision being deleted by this one.
 */
export async function syncAnalyticsConsent(enabled: boolean, userId: string): Promise<void> {
  const token = writePendingFor(userId, enabled);
  // SERIALISED. A quick off→on flip fires a withdraw and a restore back to
  // back; if the restore lands first the account ends up withdrawn while the
  // toggle reads ON. Chaining deliveries makes the server see them in the
  // order the user made them. The chain swallows failures so one bad request
  // cannot poison the next.
  const run = inFlight.then(async () => {
    const delivered = await deliver(enabled);
    if (delivered) removePendingIfCurrent(userId, token);
  });
  inFlight = run.catch(() => {});
  return run;
}

/**
 * Record a decision made at SIGNUP, for delivery by the sign-in that follows.
 *
 * THE GAP THIS CLOSES. Both signup surfaces recorded the CLIENT half only
 * (`recordAnalyticsConsentDecision`) and never the server one, so
 * `analytics_consent_withdrawn_at` stayed NULL for someone who explicitly
 * declined — and NULL means CAPTURE ALLOWED on the backend, which creates a
 * PostHog person for them the first time any server-side event fires against
 * their id (earliest is a RevenueCat webhook), for the life of the account.
 * Declining is the commonest answer and it fires no change handler at all (the
 * box starts unticked), so this cannot hang off the checkbox — it hangs off
 * signup SUCCESS, where the account it belongs to exists.
 *
 * WHY IT DOES NOT DELIVER, unlike {@link syncAnalyticsConsent}. Neither signup
 * surface owns a session at the moment it records: email signup gets an OTP
 * back rather than a session, and the OAuth callback has to record BEFORE
 * `signIn` (`identifyUser` is refused until the decision is stored). A POST
 * fired from there carries whatever token this browser happens to hold, and
 * /signup and /auth/callback are PUBLIC routes reachable while another account
 * is signed in — so the request would authenticate as, and stamp, the WRONG
 * account. The marker is written under the NEW user's id instead, and the
 * `flushAnalyticsConsentSync` inside `signIn` — running moments later with
 * that user's own token — is what delivers it, retrying on every later
 * sign-in/sign-out until the server accepts it.
 *
 * SYNCHRONOUS on purpose: `signIn` follows immediately on the OAuth path and
 * is what READS this marker, so anything that deferred the write would race
 * its own flush (mobile shipped exactly that bug — see
 * mobile/src/screens/auth/SignUpScreen.tsx).
 *
 * TAKES THIS ACCOUNT'S SLOT ONLY. This used to overwrite whatever was in the
 * single slot, including another account's undelivered decision, and justified
 * it with "that account's own next sign-in would not have delivered it
 * either". It would have: before the overwrite the marker carried THEIR id, so
 * their flush was exactly the thing that would have picked it up. The
 * overwrite was what made the claim true, and it destroyed a withdrawal that
 * had already been explicitly asked for. The store is keyed by account now —
 * see PendingConsent — so a signup on a shared browser cannot silently answer
 * for the last person who used it.
 */
export function queueAnalyticsConsentForSignup(enabled: boolean, userId: string): void {
  writePendingFor(userId, enabled);
}

/**
 * Deliver any decision that never reached the server, called once a session
 * is confirmed (sign-in, or a restored bootstrap session).
 *
 * A decision belongs to the account that made it, and the store is keyed by
 * account, so this reads THIS user's entry and no other. Entries belonging to
 * other accounts that have used this browser are left UNTOUCHED: neither
 * delivered (it was never this account's choice) nor deleted (that account's
 * own sign-out flush, or a later sign-in of theirs, is what gets to retire
 * it).
 *
 * SHARES THE DELIVERY CHAIN with `syncAnalyticsConsent`. Since signup queues a
 * decision for this function to deliver, the flush runs on the way into the
 * app for every new account rather than only as a rare retry — so a Profile
 * toggle flipped while a flush is still on the wire would otherwise race it,
 * and a signup decline followed by an opt-in could land as restore-then-
 * withdraw, leaving the account withdrawn while the toggle reads ON.
 *
 * The entry is read BEFORE queueing, so an account with nothing pending costs
 * nothing and cannot delay anyone else's delivery.
 */
export async function flushAnalyticsConsentSync(userId: string): Promise<void> {
  const pending = readPendingFor(userId);
  if (pending === null) return;

  const run = inFlight.then(async () => {
    const delivered = await deliver(pending.enabled);
    if (delivered) removePendingIfCurrent(userId, pending.token);
  });
  inFlight = run.catch(() => {});
  return run;
}

/** Drop every pending decision, for every account this browser holds one for. */
export async function clearAnalyticsConsentSync(): Promise<void> {
  removePending();
}
