import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/api/users';

/**
 * A LOCAL DECISION THE SERVER HAS NOT HEARD YET IS NEWER THAN THE SERVER.
 *
 * The server consent reconcile (lib/analyticsConsentServerReconcile.ts) copies
 * the account's recorded answer onto this browser. The account's record is only
 * as current as the last decision that REACHED it — and `analyticsConsentSync`
 * exists precisely because some don't: a Profile toggle whose POST fails
 * (offline, a 5xx, a reload mid-flight) is queued for delivery on the next
 * sign-in/bootstrap.
 *
 * THE FAILURE: A turns analytics OFF in Profile; the withdraw POST fails. Local:
 * declined, queue holds `enabled:false`. Server: still granted. On the next
 * load the reconcile saw "server granted vs local declined", wrote GRANTED and
 * identified A — overriding an explicit withdrawal — then the flush delivered
 * the withdrawal, and the load after that flipped back. The grant direction is
 * the mirror image.
 *
 * And a related race: the identify after the reconcile's `/users/me` read went
 * out even if sign-out had completed meanwhile, re-attaching the departed
 * account after `resetAnalytics()`.
 *
 * Everything below runs the REAL auth store, reconcile, decision, consent and
 * sync modules; only the posthog leaf and the HTTP functions are mocked. The
 * bug lives in how those pieces compose, so a test that mocked any of them
 * could not see it.
 *
 * "IDENTIFIED" MEANS TRANSMITTED. The real `identifyUser` re-reads the mode and
 * refuses in 'anonymous'/'off'; the auth store calling it for a declined user is
 * a no-op by design. So each call is recorded with whether the real gate
 * (`identifyAllowed(currentAnalyticsMode())`) would have let it through at that
 * instant, and that is what these assertions are about.
 */

const identifies: { id: string; transmitted: boolean }[] = [];
const transmittedIdentifies = () => identifies.filter((c) => c.transmitted).map((c) => c.id);

const identifyUser = vi.fn();
const disableAnalytics = vi.fn();
const initAnalytics = vi.fn();
const resetAnalytics = vi.fn();
vi.mock('@/lib/posthog', () => ({
  identifyUser: (...a: unknown[]) => identifyUser(...a),
  disableAnalytics: (...a: unknown[]) => disableAnalytics(...a),
  initAnalytics: (...a: unknown[]) => initAnalytics(...a),
  resetAnalytics: (...a: unknown[]) => resetAnalytics(...a),
}));

const getCurrentUser = vi.fn();
const withdrawAnalyticsConsent = vi.fn();
const restoreAnalyticsConsent = vi.fn();
vi.mock('@/api/users', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
  withdrawAnalyticsConsent: (...a: unknown[]) => withdrawAnalyticsConsent(...a),
  restoreAnalyticsConsent: (...a: unknown[]) => restoreAnalyticsConsent(...a),
}));

const mockI18n = { language: 'en' };
vi.mock('@/i18n', () => ({ default: mockI18n }));

const channels: MockBroadcastChannel[] = [];
class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    channels.push(this);
  }
}

const USER_ID = 'user-A';
const AUTH_USER = { id: USER_ID, email: 'a@example.com', first_name: 'A', last_name: 'One' };

function profile(overrides: Partial<User>): User {
  return {
    id: USER_ID,
    email: 'a@example.com',
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

const WITHDRAWN = profile({ analytics_consent_withdrawn_at: '2026-09-05T00:00:00Z' });
const GRANTED = profile({ analytics_consent_granted_at: '2026-09-01T00:00:00Z' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function setSessionHint(present: boolean): void {
  document.cookie = present
    ? 'cc_session=1; path=/'
    : 'cc_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

async function loadModules() {
  const api = await import('@/lib/api');
  const consent = await import('@/lib/analyticsConsent');
  const mode = await import('@/lib/analyticsMode');
  const decision = await import('@/lib/analyticsConsentDecision');
  const sync = await import('@/lib/analyticsConsentSync');
  const { useAuthStore } = await import('@/store/authStore');
  identifyUser.mockImplementation((id: string) => {
    identifies.push({ id, transmitted: mode.identifyAllowed(mode.currentAnalyticsMode()) });
  });
  return { api, consent, mode, decision, sync, useAuthStore };
}
type Modules = Awaited<ReturnType<typeof loadModules>>;

/** Let every chained promise (read, flush chain, deferred identify) settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 25; i++) await Promise.resolve();
}

/** The two authenticated entries, as the app reaches them. */
const ENTRIES = {
  bootstrap: async (m: Modules) => {
    setSessionHint(true);
    vi.mocked(m.api.apiClient.post).mockResolvedValue({
      data: { session: { access_token: 'tok', expires_at: 1 } },
    } as never);
    await m.useAuthStore.getState().bootstrap();
  },
  signIn: async (m: Modules) => {
    m.useAuthStore.getState().signIn({ access_token: 'tok' }, AUTH_USER);
  },
} as const;

/**
 * ProfilePage.handleAnalyticsToggle for account A, with the server half FAILING
 * — so the answer is recorded locally and left queued. The browser previously
 * held the opposite answer, owned by A.
 */
async function answerInProfileButDeliveryFails(m: Modules, enabled: boolean): Promise<void> {
  m.consent.setAnalyticsConsent(!enabled);
  m.consent.setAnalyticsConsentOwner(USER_ID);

  m.decision.recordAnalyticsConsentDecision(enabled, { id: USER_ID });
  (enabled ? restoreAnalyticsConsent : withdrawAnalyticsConsent).mockResolvedValueOnce(false);
  await m.sync.syncAnalyticsConsent(enabled, USER_ID);

  expect(m.sync.hasQueuedAnalyticsConsent(USER_ID)).toBe(true);
  expect(m.consent.getAnalyticsConsentState()).toBe(enabled ? 'granted' : 'declined');

  // Only what the NEXT authenticated entry does is under test.
  identifies.length = 0;
  identifyUser.mockClear();
  disableAnalytics.mockClear();
  initAnalytics.mockClear();
  withdrawAnalyticsConsent.mockClear();
  restoreAnalyticsConsent.mockClear();
}

beforeEach(() => {
  localStorage.clear();
  identifies.length = 0;
  channels.length = 0;
  mockI18n.language = 'en';
  setSessionHint(false);
  vi.resetModules();
  vi.clearAllMocks();
  withdrawAnalyticsConsent.mockResolvedValue(true);
  restoreAnalyticsConsent.mockResolvedValue(true);
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('(1) a queued WITHDRAWAL meets a server that still says granted — bootstrap', () => {
  it('keeps the local withdrawal, identifies no one, and the flush then delivers it', async () => {
    const m = await loadModules();
    await answerInProfileButDeliveryFails(m, false);
    getCurrentUser.mockResolvedValue(GRANTED);

    await ENTRIES.bootstrap(m);
    await settle();

    expect(m.useAuthStore.getState().isAuthenticated).toBe(true);
    // The explicit withdrawal stands — not overwritten by the stale server copy.
    expect(m.consent.getAnalyticsConsentState()).toBe('declined');
    expect(m.consent.getAnalyticsConsentOwner()).toBe(USER_ID);
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(transmittedIdentifies()).toEqual([]);
    // …and the server is told.
    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
    expect(m.sync.hasQueuedAnalyticsConsent(USER_ID)).toBe(false);
  });

  it('still keeps it when the flush fails AGAIN (still offline)', async () => {
    const m = await loadModules();
    await answerInProfileButDeliveryFails(m, false);
    getCurrentUser.mockResolvedValue(GRANTED);
    withdrawAnalyticsConsent.mockResolvedValue(false);

    await ENTRIES.bootstrap(m);
    await settle();

    expect(m.consent.getAnalyticsConsentState()).toBe('declined');
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(transmittedIdentifies()).toEqual([]);
    // Retained for the next attempt.
    expect(m.sync.hasQueuedAnalyticsConsent(USER_ID)).toBe(true);
  });
});

describe('(2) the same case on signIn — no race, whichever of the read and the flush lands first', () => {
  it.each([
    ['the flush delivers BEFORE the stale read returns', 'flush-first'],
    ['the read returns BEFORE the flush delivers', 'read-first'],
  ] as const)('%s', async (_label, which) => {
    const m = await loadModules();
    await answerInProfileButDeliveryFails(m, false);

    const read = deferred<User>();
    const delivery = deferred<boolean>();
    getCurrentUser.mockReturnValue(read.promise);
    withdrawAnalyticsConsent.mockReturnValue(delivery.promise);

    await ENTRIES.signIn(m);
    await settle();

    // Both are on the wire; nothing has been identified yet.
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(identifyUser).not.toHaveBeenCalled();

    if (which === 'flush-first') {
      delivery.resolve(true);
      await settle();
      // THE WINDOW: the queue is already empty, and the read that is about to
      // land was answered before the withdrawal reached the server.
      expect(m.sync.hasQueuedAnalyticsConsent(USER_ID)).toBe(false);
      read.resolve(GRANTED);
    } else {
      read.resolve(GRANTED);
      await settle();
      expect(m.consent.getAnalyticsConsentState()).toBe('declined');
      delivery.resolve(true);
    }
    await settle();

    expect(m.consent.getAnalyticsConsentState()).toBe('declined');
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(transmittedIdentifies()).toEqual([]);
    expect(withdrawAnalyticsConsent).toHaveBeenCalledTimes(1);
    expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
    expect(m.sync.hasQueuedAnalyticsConsent(USER_ID)).toBe(false);
  });

  it('a Profile toggle made WHILE the read is in flight is not overwritten by it', async () => {
    const m = await loadModules();
    m.consent.setAnalyticsConsent(true);
    m.consent.setAnalyticsConsentOwner(USER_ID);

    const read = deferred<User>();
    const delivery = deferred<boolean>();
    getCurrentUser.mockReturnValue(read.promise);
    withdrawAnalyticsConsent.mockReturnValue(delivery.promise);

    await ENTRIES.signIn(m);
    await settle();

    // A switches analytics OFF while /users/me is still out; the withdraw POST
    // is still on the wire too.
    m.decision.recordAnalyticsConsentDecision(false, { id: USER_ID });
    void m.sync.syncAnalyticsConsent(false, USER_ID);

    // The read was answered before the toggle.
    read.resolve(GRANTED);
    await settle();

    expect(m.consent.getAnalyticsConsentState()).toBe('declined');
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(transmittedIdentifies()).toEqual([]);

    delivery.resolve(true);
    await settle();
    expect(m.sync.hasQueuedAnalyticsConsent(USER_ID)).toBe(false);
  });
});

describe('(3) a queued GRANT meets a server that still says withdrawn', () => {
  it.each(['bootstrap', 'signIn'] as const)(
    'keeps the local grant, tears nothing down, and delivers the restore — %s',
    async (entry) => {
      const m = await loadModules();
      await answerInProfileButDeliveryFails(m, true);
      getCurrentUser.mockResolvedValue(WITHDRAWN);

      await ENTRIES[entry](m);
      await settle();

      expect(m.consent.getAnalyticsConsentState()).toBe('granted');
      expect(disableAnalytics).not.toHaveBeenCalled();
      // Identify follows the LOCAL, newer answer.
      expect(transmittedIdentifies()).toEqual([USER_ID]);
      expect(restoreAnalyticsConsent).toHaveBeenCalledTimes(1);
      expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
      expect(m.sync.hasQueuedAnalyticsConsent(USER_ID)).toBe(false);
    }
  );
});

describe('(4) nothing queued — the reconcile behaves exactly as before', () => {
  it.each(['bootstrap', 'signIn'] as const)(
    'a server WITHDRAWAL still overrides a stale local grant, teardown before identify — %s',
    async (entry) => {
      const m = await loadModules();
      m.consent.setAnalyticsConsent(true);
      m.consent.setAnalyticsConsentOwner(USER_ID);
      const order: string[] = [];
      disableAnalytics.mockImplementation(() => void order.push('teardown'));
      const baseIdentify = identifyUser.getMockImplementation()!;
      identifyUser.mockImplementation((id: string) => {
        order.push('identify');
        baseIdentify(id);
      });
      getCurrentUser.mockResolvedValue(WITHDRAWN);

      await ENTRIES[entry](m);
      await settle();

      expect(m.consent.getAnalyticsConsentState()).toBe('declined');
      expect(m.consent.getAnalyticsConsentOwner()).toBe(USER_ID);
      expect(order[0]).toBe('teardown');
      expect(transmittedIdentifies()).toEqual([]);
      // A restore, never a publish: nothing queued, nothing sent.
      expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
      expect(restoreAnalyticsConsent).not.toHaveBeenCalled();
    }
  );

  it.each(['bootstrap', 'signIn'] as const)(
    'a server GRANT still overrides a stale local decline and identifies — %s',
    async (entry) => {
      const m = await loadModules();
      m.consent.setAnalyticsConsent(false);
      m.consent.setAnalyticsConsentOwner(USER_ID);
      getCurrentUser.mockResolvedValue(GRANTED);

      await ENTRIES[entry](m);
      await settle();

      expect(m.consent.getAnalyticsConsentState()).toBe('granted');
      expect(m.consent.getAnalyticsConsentOwner()).toBe(USER_ID);
      expect(initAnalytics).toHaveBeenCalled();
      expect(transmittedIdentifies()).toContain(USER_ID);
    }
  );

  it("ANOTHER account's queued decision does not block this account's reconcile", async () => {
    const m = await loadModules();
    // user-B's withdrawal, undelivered, left on this shared browser.
    withdrawAnalyticsConsent.mockResolvedValueOnce(false);
    await m.sync.syncAnalyticsConsent(false, 'user-B');
    withdrawAnalyticsConsent.mockClear();

    m.consent.setAnalyticsConsent(true);
    m.consent.setAnalyticsConsentOwner(USER_ID);
    getCurrentUser.mockResolvedValue(WITHDRAWN);

    await ENTRIES.signIn(m);
    await settle();

    expect(m.consent.getAnalyticsConsentState()).toBe('declined');
    expect(transmittedIdentifies()).toEqual([]);
    // B's entry is neither delivered under A nor dropped.
    expect(withdrawAnalyticsConsent).not.toHaveBeenCalled();
    expect(m.sync.hasQueuedAnalyticsConsent('user-B')).toBe(true);
  });
});

describe('(5) the session ends while signIn\'s /users/me read is still in flight', () => {
  async function signInThenEndSessionDuringRead(
    m: Modules,
    local: boolean,
    server: User,
    how: 'signOut' | 'another tab'
  ): Promise<void> {
    m.consent.setAnalyticsConsent(local);
    m.consent.setAnalyticsConsentOwner(USER_ID);
    const read = deferred<User>();
    getCurrentUser.mockReturnValue(read.promise);
    vi.mocked(m.api.apiClient.post).mockResolvedValue({ success: true } as never);

    await ENTRIES.signIn(m);
    await settle();
    expect(identifyUser).not.toHaveBeenCalled();

    if (how === 'signOut') {
      await m.useAuthStore.getState().signOut();
    } else {
      const channel = channels[channels.length - 1];
      channel.onmessage?.({ data: { type: 'logout' } } as MessageEvent);
    }
    expect(resetAnalytics).toHaveBeenCalled();
    expect(m.useAuthStore.getState().isAuthenticated).toBe(false);

    disableAnalytics.mockClear();
    initAnalytics.mockClear();
    identifyUser.mockClear();
    identifies.length = 0;

    read.resolve(server);
    await settle();
  }

  it('records no reconciled decision and identifies no one (server grant vs local decline)', async () => {
    const m = await loadModules();
    await signInThenEndSessionDuringRead(m, false, GRANTED, 'signOut');

    expect(m.consent.getAnalyticsConsentState()).toBe('declined');
    expect(initAnalytics).not.toHaveBeenCalled();
    expect(identifyUser).not.toHaveBeenCalled();
  });

  it('does not tear down or record a withdrawal for the departed account either', async () => {
    const m = await loadModules();
    await signInThenEndSessionDuringRead(m, true, WITHDRAWN, 'signOut');

    expect(m.consent.getAnalyticsConsentState()).toBe('granted');
    expect(disableAnalytics).not.toHaveBeenCalled();
    expect(identifyUser).not.toHaveBeenCalled();
  });

  it('does not re-identify the departed account even when server and browser agree', async () => {
    const m = await loadModules();
    await signInThenEndSessionDuringRead(m, true, GRANTED, 'signOut');

    expect(identifyUser).not.toHaveBeenCalled();
  });

  it('holds for a logout that arrives from another tab', async () => {
    const m = await loadModules();
    await signInThenEndSessionDuringRead(m, true, GRANTED, 'another tab');

    expect(identifyUser).not.toHaveBeenCalled();
  });

  it('a NEW sign-in during the read supersedes it: only the new one identifies', async () => {
    const m = await loadModules();
    m.consent.setAnalyticsConsent(true);
    m.consent.setAnalyticsConsentOwner(USER_ID);
    const firstRead = deferred<User>();
    getCurrentUser.mockReturnValueOnce(firstRead.promise).mockResolvedValue(GRANTED);

    await ENTRIES.signIn(m);
    await settle();
    await ENTRIES.signIn(m);
    await settle();
    expect(identifyUser).toHaveBeenCalledTimes(1);

    identifyUser.mockClear();
    firstRead.resolve(GRANTED);
    await settle();

    expect(identifyUser).not.toHaveBeenCalled();
  });
});
