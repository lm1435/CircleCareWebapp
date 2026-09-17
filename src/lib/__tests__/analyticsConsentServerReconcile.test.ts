import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/api/users';

/**
 * THE ACCOUNT'S OWN ANSWER, READ BACK ONTO A BROWSER THAT LOST IT.
 *
 * Web persists the consent answer in ONE key in ONE browser
 * (`cc_analytics_enabled`) and has never read the server. The backend has
 * stamped `analytics_consent_withdrawn_at` / `analytics_consent_granted_at` on
 * the user row all along, and `GET /users/me` already returns both — web's
 * `getCurrentUser` is an untyped passthrough, so the fields arrive today and
 * are discarded.
 *
 * THE FAILURE BEING FIXED: someone withdraws on their phone browser. The server
 * stamps `withdrawn_at` and deletes their PostHog person. Their laptop's
 * localStorage still says granted, so every page load re-runs `identifyUser`
 * and RE-CREATES that person — forever, until that browser's site data is
 * cleared. They were told their data was deleted.
 *
 * Ported from mobile/src/services/analyticsConsentServerReconcile.ts, which
 * this mirrors deliberately, plus two complications mobile does not have:
 * OWNERSHIP (a reconciled write must be claimed for the account, or the next
 * account to sign in adopts it) and ORDERING (web's `identifyUser` is
 * synchronous and the server read is not).
 */

const disableAnalytics = vi.fn();
const initAnalytics = vi.fn();
const identifyUser = vi.fn();
const getCurrentUser = vi.fn();

// The REAL `analyticsConsentDecision` is deliberately left unmocked: it is the
// one place a consent answer becomes client state, and a reconcile that
// reimplemented its teardown/re-init/re-identify sequence is exactly the drift
// that module exists to prevent. Only the posthog leaf below is mocked.
vi.mock('@/lib/posthog', () => ({
  disableAnalytics: (...a: unknown[]) => disableAnalytics(...a),
  initAnalytics: (...a: unknown[]) => initAnalytics(...a),
  identifyUser: (...a: unknown[]) => identifyUser(...a),
}));

vi.mock('@/api/users', () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
}));

// The SERVER half of consent. The reconcile must never touch ANY of it.
const syncAnalyticsConsent = vi.fn();
const queueAnalyticsConsentForSignup = vi.fn();
const flushAnalyticsConsentSync = vi.fn();
const clearAnalyticsConsentSync = vi.fn();
// The ONE read the reconcile may make of the server half: "is an undelivered
// decision queued for this account?"
const hasQueuedAnalyticsConsent = vi.fn((_userId: string) => false);
vi.mock('@/lib/analyticsConsentSync', () => ({
  syncAnalyticsConsent: (...a: unknown[]) => syncAnalyticsConsent(...a),
  queueAnalyticsConsentForSignup: (...a: unknown[]) => queueAnalyticsConsentForSignup(...a),
  flushAnalyticsConsentSync: (...a: unknown[]) => flushAnalyticsConsentSync(...a),
  clearAnalyticsConsentSync: (...a: unknown[]) => clearAnalyticsConsentSync(...a),
  hasQueuedAnalyticsConsent: (...a: unknown[]) => hasQueuedAnalyticsConsent(...(a as [string])),
}));

const USER_ID = '11111111-1111-4111-8111-111111111111';

/** A profile row as `GET /users/me` returns it, with the two stamps set. */
function profile(overrides: Partial<User>): User {
  return {
    id: USER_ID,
    email: 'pat@example.com',
    notification_preferences: {
      medication_confirmations: true,
      missed_medications: true,
      task_assignments: true,
      appointment_reminders: true,
      activity_updates: true,
      chat_messages: true,
      note_nudges: true,
    },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    analytics_consent_withdrawn_at: null,
    analytics_consent_granted_at: null,
    ...overrides,
  } as User;
}

async function load() {
  vi.resetModules();
  const consent = await import('@/lib/analyticsConsent');
  const mod = await import('@/lib/analyticsConsentServerReconcile');
  const api = await import('@/lib/api');
  return { ...consent, ...mod, apiClient: api.apiClient };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  hasQueuedAnalyticsConsent.mockImplementation(() => false);
});

describe('a QUEUED, undelivered local decision is newer than the server', () => {
  const WITHDRAWN = { analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' };
  const GRANTED = { analytics_consent_granted_at: '2026-09-01T00:00:00Z' };

  it('asks about THIS account only', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent } = await load();
    setAnalyticsConsent(true);

    await reconcileAnalyticsConsentFromServer(USER_ID, profile(WITHDRAWN));

    expect(hasQueuedAnalyticsConsent).toHaveBeenCalled();
    for (const [id] of hasQueuedAnalyticsConsent.mock.calls) expect(id).toBe(USER_ID);
  });

  it('leaves a queued local GRANT alone when the server says withdrawn — no teardown', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);
    hasQueuedAnalyticsConsent.mockImplementation(() => true);

    await reconcileAnalyticsConsentFromServer(USER_ID, profile(WITHDRAWN));

    expect(getAnalyticsConsentState()).toBe('granted');
    expect(disableAnalytics).not.toHaveBeenCalled();
  });

  it('leaves a queued local DECLINE alone when the server says granted — no init, no identify', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(false);
    hasQueuedAnalyticsConsent.mockImplementation(() => true);

    await reconcileAnalyticsConsentFromServer(USER_ID, profile(GRANTED));

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(identifyUser).not.toHaveBeenCalled();
  });

  /**
   * The queue's state is keyed to the READ — whether /users/me has answered —
   * never to how many times it is consulted, so each of the two checks is
   * pinned by exactly one of these tests.
   */
  async function reconcileWhileQueueChanges(queued: (answered: boolean) => boolean) {
    // ONE module instance for seeding, reconciling and reading back — `load()`
    // resets modules, and a state read through a stale instance's cache would
    // pass whatever the reconcile did.
    const m = await load();
    m.setAnalyticsConsent(false);
    let answered = false;
    hasQueuedAnalyticsConsent.mockImplementation(() => queued(answered));
    let release!: (u: User) => void;
    const read = new Promise<User>((r) => (release = r));
    const done = m.reconcileAnalyticsConsentFromServer(USER_ID, read);
    answered = true;
    release(profile(GRANTED));
    await done;
    return { state: m.getAnalyticsConsentState(), initAnalyticsCalls: initAnalytics.mock.calls.length };
  }

  it('stands aside when the entry was queued only BEFORE the read (a flush cleared it meanwhile)', async () => {
    const after = await reconcileWhileQueueChanges((answered) => !answered);

    expect(after.state).toBe('declined');
    expect(after.initAnalyticsCalls).toBe(0);
  });

  it('stands aside when the entry was queued only DURING the read (a toggle meanwhile)', async () => {
    const after = await reconcileWhileQueueChanges((answered) => answered);

    expect(after.state).toBe('declined');
    expect(after.initAnalyticsCalls).toBe(0);
  });

  it('an unreadable queue reads as nothing queued, and still never throws', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);
    hasQueuedAnalyticsConsent.mockImplementation(() => {
      throw new Error('storage exploded');
    });

    await expect(
      reconcileAnalyticsConsentFromServer(USER_ID, profile(WITHDRAWN))
    ).resolves.toBeUndefined();
    expect(getAnalyticsConsentState()).toBe('declined');
  });
});

describe('only for the session that asked', () => {
  it('records nothing when the session has ended by the time the read lands', async () => {
    const {
      reconcileAnalyticsConsentFromServer,
      setAnalyticsConsent,
      getAnalyticsConsentState,
      getAnalyticsConsentOwner,
    } = await load();
    setAnalyticsConsent(false);

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_granted_at: '2026-09-01T00:00:00Z' }),
      () => false
    );

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(getAnalyticsConsentOwner()).toBeNull();
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(identifyUser).not.toHaveBeenCalled();
  });

  it('identifyAfterServerReconcile does not identify once the session has ended', async () => {
    const { identifyAfterServerReconcile, setAnalyticsConsent } = await load();
    setAnalyticsConsent(true);
    let live = true;
    let release!: (u: User) => void;
    getCurrentUser.mockReturnValueOnce(new Promise<User>((r) => (release = r)));

    const done = identifyAfterServerReconcile(USER_ID, undefined, () => live);
    live = false; // sign-out completes while /users/me is out
    release(profile({ analytics_consent_granted_at: '2026-09-01T00:00:00Z' }));
    await done;

    expect(identifyUser).not.toHaveBeenCalled();
  });

  it('identifies as before while the session is still live', async () => {
    const { identifyAfterServerReconcile, setAnalyticsConsent } = await load();
    setAnalyticsConsent(true);

    await identifyAfterServerReconcile(
      USER_ID,
      profile({ analytics_consent_granted_at: '2026-09-01T00:00:00Z' }),
      () => true
    );

    expect(identifyUser).toHaveBeenCalledWith(USER_ID);
  });
});

describe('deriveServerConsent', () => {
  it("returns 'unknown' when the backend cannot answer (field UNDEFINED, not null)", async () => {
    const { deriveServerConsent } = await load();
    // A backend build that predates the columns sends neither field. That is
    // "cannot answer", NOT "no decision" — the distinction hourCycle.ts makes
    // at `uses_24h_clock === true/false` for the same reason. A falsy check
    // here reads a missing column as a decision and lets a stale backend
    // overwrite a real answer on EVERY page load, permanently, since that
    // backend can never stamp anything to close the branch again.
    expect(deriveServerConsent({})).toBe('unknown');
    expect(deriveServerConsent({ analytics_consent_withdrawn_at: null })).toBe('unknown');
    expect(deriveServerConsent({ analytics_consent_granted_at: null })).toBe('unknown');
  });

  it("returns 'unasked' when the backend answered and there is no stamp", async () => {
    const { deriveServerConsent } = await load();
    expect(
      deriveServerConsent({
        analytics_consent_withdrawn_at: null,
        analytics_consent_granted_at: null,
      })
    ).toBe('unasked');
  });

  it("returns 'granted' for a granted stamp", async () => {
    const { deriveServerConsent } = await load();
    expect(
      deriveServerConsent({
        analytics_consent_withdrawn_at: null,
        analytics_consent_granted_at: '2026-09-01T00:00:00Z',
      })
    ).toBe('granted');
  });

  it("returns 'declined' for a withdrawal — and WITHDRAWN WINS when both are stamped", async () => {
    const { deriveServerConsent } = await load();
    expect(
      deriveServerConsent({
        analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z',
        analytics_consent_granted_at: null,
      })
    ).toBe('declined');
    // Granted first, withdrawn later: both columns are stamped. The withdrawal
    // is the more recent statement of intent and the safer one to honour.
    expect(
      deriveServerConsent({
        analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z',
        analytics_consent_granted_at: '2026-09-01T00:00:00Z',
      })
    ).toBe('declined');
  });
});

describe('server DECLINED overrides a stale local grant', () => {
  it('tears the client down, records declined, and claims the answer for the account', async () => {
    const {
      reconcileAnalyticsConsentFromServer,
      setAnalyticsConsent,
      getAnalyticsConsentState,
      getAnalyticsConsentOwner,
    } = await load();

    // The laptop that never heard about the phone-browser withdrawal.
    setAnalyticsConsent(true);

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' })
    );

    expect(getAnalyticsConsentState()).toBe('declined');
    // The REAL teardown, through analyticsConsentDecision — dropping the
    // batched queue built up before the withdrawal is the whole point.
    expect(disableAnalytics).toHaveBeenCalledTimes(1);
    expect(identifyUser).not.toHaveBeenCalled();
    // OWNERSHIP (web-only): `setAnalyticsConsent` deliberately leaves a new
    // answer ownerless, so without a stamp the NEXT account to sign in on this
    // browser adopts this decline as its own.
    expect(getAnalyticsConsentOwner()).toBe(USER_ID);
  });
});

describe('server GRANTED overrides a stale local decline', () => {
  it('records granted, re-inits, re-identifies, and claims the answer', async () => {
    const {
      reconcileAnalyticsConsentFromServer,
      setAnalyticsConsent,
      getAnalyticsConsentState,
      getAnalyticsConsentOwner,
    } = await load();

    setAnalyticsConsent(false);

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_granted_at: '2026-09-01T00:00:00Z' })
    );

    expect(getAnalyticsConsentState()).toBe('granted');
    expect(initAnalytics).toHaveBeenCalled();
    expect(identifyUser).toHaveBeenCalledWith(USER_ID);
    expect(disableAnalytics).not.toHaveBeenCalled();
    expect(getAnalyticsConsentOwner()).toBe(USER_ID);
  });

  it('also grants when this browser has never been asked', async () => {
    const { reconcileAnalyticsConsentFromServer, getAnalyticsConsentState } = await load();

    // 'unasked' — a different browser, or one whose site data was cleared.
    expect(getAnalyticsConsentState()).toBe('unasked');

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_granted_at: '2026-09-01T00:00:00Z' })
    );

    expect(getAnalyticsConsentState()).toBe('granted');
  });
});

describe('the cases that must change NOTHING', () => {
  it("leaves a local grant alone when the server says 'unasked'", async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);

    await reconcileAnalyticsConsentFromServer(USER_ID, profile({}));

    // GRANDFATHER_UNASKED_WEB_USERS is false and stays intact: an account with
    // no recorded answer is not evidence of either answer, in either direction.
    expect(getAnalyticsConsentState()).toBe('granted');
    expect(disableAnalytics).not.toHaveBeenCalled();
  });

  it("leaves a local decline alone when the server says 'unasked'", async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(false);

    await reconcileAnalyticsConsentFromServer(USER_ID, profile({}));

    expect(getAnalyticsConsentState()).toBe('declined');
    expect(initAnalytics).not.toHaveBeenCalled();
  });

  it('changes nothing when the backend has no such columns (unknown)', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);

    // A profile from a backend build without the columns.
    const stale = { id: USER_ID, email: 'pat@example.com' } as User;
    await reconcileAnalyticsConsentFromServer(USER_ID, stale);

    expect(getAnalyticsConsentState()).toBe('granted');
    expect(disableAnalytics).not.toHaveBeenCalled();
  });

  it('writes nothing at all when local and server already agree', async () => {
    const {
      reconcileAnalyticsConsentFromServer,
      setAnalyticsConsent,
      subscribeToAnalyticsConsent,
    } = await load();
    setAnalyticsConsent(true);

    // Agreement is the NORMAL case and it must cost nothing: this runs on every
    // authenticated entry, and re-announcing the value subscribers already hold
    // re-renders on every page load.
    const notified = vi.fn();
    subscribeToAnalyticsConsent(notified);

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_granted_at: '2026-09-01T00:00:00Z' })
    );

    expect(notified).not.toHaveBeenCalled();
    expect(disableAnalytics).not.toHaveBeenCalled();
    expect(initAnalytics).not.toHaveBeenCalled();
  });
});

describe('A RESTORE, NEVER A PUBLISH', () => {
  it('never writes the reconciled answer back to the server', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, apiClient } = await load();
    setAnalyticsConsent(true);

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' })
    );

    // Two devices that both write back trade a withdraw/restore pair on every
    // launch and hammer the per-user rate limiter — and a reconcile that can
    // write is a reconcile that can propagate a WRONG local value to the
    // account, which is the opposite of what it is for.
    expect(syncAnalyticsConsent).not.toHaveBeenCalled();
    expect(queueAnalyticsConsentForSignup).not.toHaveBeenCalled();
    expect(clearAnalyticsConsentSync).not.toHaveBeenCalled();
    expect(flushAnalyticsConsentSync).not.toHaveBeenCalled();
    // Nothing mutating on the wire either.
    expect(apiClient.post).not.toHaveBeenCalled();
    expect(apiClient.patch).not.toHaveBeenCalled();
    expect(apiClient.put).not.toHaveBeenCalled();
    expect(apiClient.delete).not.toHaveBeenCalled();
  });

  it("leaves the pending-sync marker untouched in BOTH directions", async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent } = await load();
    setAnalyticsConsent(true);
    // A decision that failed to reach the server is parked here for retry by
    // `flushAnalyticsConsentSync`. The reconcile must neither consume nor
    // rewrite it — it is a record of something the USER did on this browser.
    localStorage.setItem(
      'analytics_consent_pending_sync',
      JSON.stringify({ enabled: true, userId: USER_ID })
    );

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' })
    );

    expect(localStorage.getItem('analytics_consent_pending_sync')).toBe(
      JSON.stringify({ enabled: true, userId: USER_ID })
    );
  });
});

describe('it must never throw into an auth path', () => {
  it('swallows a failed /users/me read and leaves local state alone', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);
    getCurrentUser.mockRejectedValueOnce(new Error('network down'));

    await expect(reconcileAnalyticsConsentFromServer(USER_ID)).resolves.toBeUndefined();
    expect(getAnalyticsConsentState()).toBe('granted');
  });

  it('swallows a rejected profile promise handed in by the caller', async () => {
    const { reconcileAnalyticsConsentFromServer } = await load();
    await expect(
      reconcileAnalyticsConsentFromServer(USER_ID, Promise.reject(new Error('boom')))
    ).resolves.toBeUndefined();
  });

  it('records the withdrawal even if the teardown itself throws', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);
    disableAnalytics.mockImplementationOnce(() => {
      throw new Error('posthog exploded');
    });

    await expect(
      reconcileAnalyticsConsentFromServer(
        USER_ID,
        profile({ analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' })
      )
    ).resolves.toBeUndefined();

    // A THROWN TEARDOWN MUST NOT SKIP THE WRITE. The account has withdrawn, so
    // the one thing that has to happen is that this browser stops. Aborting
    // here would leave the toggle reading ON and collection running — exactly
    // what the user asked to end.
    expect(getAnalyticsConsentState()).toBe('declined');
  });
});

describe('the profile round trip', () => {
  it('uses the profile the caller already has, making NO extra request', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent } = await load();
    setAnalyticsConsent(true);

    await reconcileAnalyticsConsentFromServer(
      USER_ID,
      profile({ analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' })
    );

    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it('fetches for itself when the caller has no profile in hand', async () => {
    const { reconcileAnalyticsConsentFromServer, setAnalyticsConsent, getAnalyticsConsentState } =
      await load();
    setAnalyticsConsent(true);
    getCurrentUser.mockResolvedValueOnce(
      profile({ analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' })
    );

    await reconcileAnalyticsConsentFromServer(USER_ID);

    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(getAnalyticsConsentState()).toBe('declined');
  });
});
