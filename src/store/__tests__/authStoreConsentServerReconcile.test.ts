import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@/api/users';

/**
 * THE AUTH PATHS MUST RECONCILE THE ACCOUNT'S ANSWER BEFORE THEY IDENTIFY.
 *
 * `lib/analyticsConsentServerReconcile.ts` can only repair a browser if
 * something calls it, and it can only prevent the re-created PostHog person if
 * it runs BEFORE `identifyUser`. Web's `identifyUser` is synchronous and sits
 * at `authStore.signIn` / `authStore.bootstrap`; the server read is async. That
 * gap is the ORDERING complication mobile does not have, and these tests are
 * what stop it being left as a "known race".
 *
 * The scenario, end to end: someone withdraws consent in their phone's browser
 * (server stamps `withdrawn_at`, PostHog person deleted). Their laptop's
 * localStorage still says granted. They open the laptop.
 */

const order: string[] = [];
const identifyUser = vi.fn(() => void order.push('identify'));
const disableAnalytics = vi.fn(() => void order.push('teardown'));
const initAnalytics = vi.fn(() => void order.push('init'));
const resetAnalytics = vi.fn();

vi.mock('@/lib/posthog', () => ({
  identifyUser: (...a: unknown[]) => identifyUser(...(a as [])),
  disableAnalytics: (...a: unknown[]) => disableAnalytics(...(a as [])),
  initAnalytics: (...a: unknown[]) => initAnalytics(...(a as [])),
  resetAnalytics: (...a: unknown[]) => resetAnalytics(...(a as [])),
}));

const getCurrentUser = vi.fn();
vi.mock('@/api/users', () => ({
  getCurrentUser: (...a: unknown[]) => getCurrentUser(...(a as [])),
}));

vi.mock('@/lib/analyticsConsentSync', () => ({
  flushAnalyticsConsentSync: vi.fn(() => Promise.resolve()),
}));

const mockI18n = { language: 'en' };
vi.mock('@/i18n', () => ({ default: mockI18n }));

class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
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

function setSessionHint(present: boolean): void {
  document.cookie = present
    ? 'cc_session=1; path=/'
    : 'cc_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

async function loadModules() {
  const api = await import('@/lib/api');
  const consent = await import('@/lib/analyticsConsent');
  const mode = await import('@/lib/analyticsMode');
  const { useAuthStore } = await import('@/store/authStore');
  return { api, consent, mode, useAuthStore };
}

/** Let every already-queued microtask (and the deferred identify) settle. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  localStorage.clear();
  order.length = 0;
  mockI18n.language = 'en';
  setSessionHint(false);
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bootstrap — a restored cookie session', () => {
  it('applies a server WITHDRAWAL before identifying, so no person is re-created', async () => {
    const { api, consent, mode, useAuthStore } = await loadModules();
    // The laptop that never heard about the withdrawal.
    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner(USER_ID);

    setSessionHint(true);
    vi.mocked(api.apiClient.post).mockResolvedValue({
      data: { session: { access_token: 'tok', expires_at: 1 } },
    } as never);
    getCurrentUser.mockResolvedValue(WITHDRAWN);

    // Capture the mode AT THE MOMENT the store identifies — that is the value
    // the real `identifyUser` consults (`identifyAllowed(currentAnalyticsMode())`),
    // so it is the actual go/no-go on creating the PostHog person.
    const modesAtIdentify: string[] = [];
    identifyUser.mockImplementation(() => {
      order.push('identify');
      modesAtIdentify.push(mode.currentAnalyticsMode());
    });

    await useAuthStore.getState().bootstrap();
    await flushMicrotasks();

    expect(consent.getAnalyticsConsentState()).toBe('declined');
    // The teardown ran, and it ran FIRST. Order, not merely presence: an
    // identify that goes out before the reconcile lands has already re-created
    // the person, and tearing down afterwards does not un-create it.
    expect(order.indexOf('teardown')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('teardown')).toBeLessThan(order.indexOf('identify'));
    // …and by the time identify does run, it is refused.
    expect(modesAtIdentify).toEqual(['anonymous']);
    expect(mode.identifyAllowed('anonymous')).toBe(false);
    // The session itself is unaffected.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('costs no extra request — it reconciles from the profile it already fetched', async () => {
    const { api, consent, useAuthStore } = await loadModules();
    consent.setAnalyticsConsent(true);

    setSessionHint(true);
    vi.mocked(api.apiClient.post).mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    } as never);
    getCurrentUser.mockResolvedValue(WITHDRAWN);

    await useAuthStore.getState().bootstrap();
    await flushMicrotasks();

    // ONE /users/me for the whole bootstrap. This is why the reconcile takes an
    // optional profile at all.
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('applies a server GRANT to a browser that declined or was never asked', async () => {
    const { api, consent, useAuthStore } = await loadModules();
    // Never asked here.
    expect(consent.getAnalyticsConsentState()).toBe('unasked');

    setSessionHint(true);
    vi.mocked(api.apiClient.post).mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    } as never);
    getCurrentUser.mockResolvedValue(GRANTED);

    await useAuthStore.getState().bootstrap();
    await flushMicrotasks();

    expect(consent.getAnalyticsConsentState()).toBe('granted');
    // …and the answer is CLAIMED, or the next account to sign in on this
    // browser inherits it.
    expect(consent.getAnalyticsConsentOwner()).toBe(USER_ID);
    expect(identifyUser).toHaveBeenCalledWith(USER_ID);
  });

  it('still signs the user in when the reconcile has nothing usable to work with', async () => {
    const { api, consent, useAuthStore } = await loadModules();
    consent.setAnalyticsConsent(true);

    setSessionHint(true);
    vi.mocked(api.apiClient.post).mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    } as never);
    // A backend build without the consent columns.
    getCurrentUser.mockResolvedValue({ id: USER_ID, email: 'a@example.com' } as User);

    await useAuthStore.getState().bootstrap();
    await flushMicrotasks();

    // bootstrap reads a throw from ANYWHERE inside its try block as "no
    // session" and signs the user out — so a consent reconcile that can throw
    // is a consent reconcile that can log people out.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(consent.getAnalyticsConsentState()).toBe('granted');
  });
});

describe('signIn — a fresh sign-in, with no profile in hand', () => {
  it('does NOT identify synchronously — the identify waits for the server answer', async () => {
    const { consent, useAuthStore } = await loadModules();
    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner(USER_ID);
    getCurrentUser.mockResolvedValue(WITHDRAWN);

    useAuthStore.getState().signIn({ access_token: 'tok' }, AUTH_USER);

    // THE RACE, pinned. Auth responses carry only id/email/first_name/
    // last_name, so signIn has to read /users/me itself — and identifying while
    // that read is in flight is exactly the bug: the $identify for a withdrawn
    // account goes out and re-creates the person.
    expect(identifyUser).not.toHaveBeenCalled();
    // The session is available immediately regardless — analytics must never
    // gate authentication.
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    await flushMicrotasks();

    expect(getCurrentUser).toHaveBeenCalledTimes(1);
    expect(consent.getAnalyticsConsentState()).toBe('declined');
    expect(order.indexOf('teardown')).toBeLessThan(order.indexOf('identify'));
  });

  it('identifies once the reconcile lands, even when the read fails', async () => {
    const { consent, useAuthStore } = await loadModules();
    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner(USER_ID);
    getCurrentUser.mockRejectedValue(new Error('offline'));

    useAuthStore.getState().signIn({ access_token: 'tok' }, AUTH_USER);
    await flushMicrotasks();

    // No server answer → the browser's own recorded answer governs, unchanged.
    expect(consent.getAnalyticsConsentState()).toBe('granted');
    expect(identifyUser).toHaveBeenCalledWith(USER_ID);
    expect(disableAnalytics).not.toHaveBeenCalled();
  });

  it('reconciles AFTER the owner check, so a stranger\'s answer is dropped first', async () => {
    const { consent, useAuthStore } = await loadModules();
    // B's answer, left on a shared browser.
    consent.setAnalyticsConsent(true);
    consent.setAnalyticsConsentOwner('user-B');
    getCurrentUser.mockResolvedValue(GRANTED);

    useAuthStore.getState().signIn({ access_token: 'tok' }, AUTH_USER);
    // Synchronously: B's answer is forgotten (the existing ownership fix).
    expect(consent.getAnalyticsConsentState()).toBe('unasked');

    await flushMicrotasks();

    // …and then A's OWN account record grants, and is stamped as A's.
    expect(consent.getAnalyticsConsentState()).toBe('granted');
    expect(consent.getAnalyticsConsentOwner()).toBe(USER_ID);
  });
});
