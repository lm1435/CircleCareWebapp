// Task 50 (store half) — authStore: signIn/bootstrap/signOut, cross-tab
// broadcast, onAuthFailure registration. `@/lib/api` is mocked by the global
// test setup; modules are re-imported per test so module-level state
// (BroadcastChannel, bootstrap single-flight) starts fresh.

// Mock the identify/reset helpers so we can assert the store passes the user's
// email to identifyUser (signIn + bootstrap). The real helpers would silently
// no-op here anyway (no VITE_POSTHOG_KEY in the test env).
vi.mock('@/lib/posthog', () => ({
  identifyUser: vi.fn(),
  resetAnalytics: vi.fn(),
}));

// Consent-sync flush is fire-and-forget from signIn/bootstrap; mock it so we
// can assert it's called with the right user id without touching real storage
// or the network.
vi.mock('@/lib/analyticsConsentSync', () => ({
  flushAnalyticsConsentSync: vi.fn(() => Promise.resolve()),
}));

// The store resolves the session-established language off the live i18n
// instance; stub it so tests can drive the tag (including region-qualified
// ones) without booting i18next.
const mockI18n = { language: 'en' };
vi.mock('@/i18n', () => ({ default: mockI18n }));

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }
}

async function loadModules() {
  const api = await import('@/lib/api');
  const { tokenAccessor } = await import('@/lib/tokenAccessor');
  const { queryClient } = await import('@/lib/queryClient');
  const posthogLib = await import('@/lib/posthog');
  const consentSyncLib = await import('@/lib/analyticsConsentSync');
  const { useAuthStore } = await import('@/store/authStore');
  return { api, tokenAccessor, queryClient, posthogLib, consentSyncLib, useAuthStore };
}

const testUser = {
  id: 'user-1',
  email: 'pat@example.com',
  first_name: 'Pat',
  last_name: 'Rivera',
};

/** Set or clear the readable `cc_session` hint cookie bootstrap checks. */
function setSessionHint(present: boolean): void {
  document.cookie = present
    ? 'cc_session=1; path=/'
    : 'cc_session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
}

describe('authStore', () => {
  beforeEach(() => {
    mockI18n.language = 'en';
    setSessionHint(false); // no session by default — tests opt in explicitly
    vi.resetModules();
    // The `@/lib/api` mock factory result is cached by vitest across
    // vi.resetModules(), so its vi.fn() call history leaks between tests
    // unless cleared here. (Assertions below count per-test calls.)
    vi.clearAllMocks();
    MockBroadcastChannel.instances = [];
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signIn stores the access token in memory only and marks the user authenticated', async () => {
    const { tokenAccessor, posthogLib, useAuthStore } = await loadModules();

    useAuthStore.getState().signIn({ access_token: 'tok-123', expires_at: 1234567890 }, testUser);

    expect(tokenAccessor.getAuthToken()).toBe('tok-123');
    expect(tokenAccessor.getExpiresAt()).toBe(1234567890);
    // Analytics identity carries the id + email (the only person property).
    expect(posthogLib.identifyUser).toHaveBeenCalledWith('user-1', 'pat@example.com');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(testUser);
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
    // Web threat model: nothing auth-related may touch JS-readable storage.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('signIn flushes any pending analytics-consent decision for the signed-in user', async () => {
    const { consentSyncLib, useAuthStore } = await loadModules();

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);

    expect(consentSyncLib.flushAnalyticsConsentSync).toHaveBeenCalledWith('user-1');
  });

  it('signIn reports session-established with the active language', async () => {
    const { api, useAuthStore } = await loadModules();

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);

    expect(api.apiClient.post).toHaveBeenCalledWith('/auth/session-established', {
      language: 'en',
    });
  });

  it('signIn narrows a region-qualified language tag to the base language', async () => {
    mockI18n.language = 'es-MX'; // browser locale, es-419 / es-MX all count as Spanish
    const { api, useAuthStore } = await loadModules();

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);

    expect(api.apiClient.post).toHaveBeenCalledWith('/auth/session-established', {
      language: 'es',
    });
  });

  it('a failing session-established never breaks the sign-in', async () => {
    const { api, tokenAccessor, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('network down'));

    expect(() =>
      useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser)
    ).not.toThrow();
    // Let the rejected fire-and-forget settle — the user stays signed in.
    await Promise.resolve();
    await Promise.resolve();

    expect(tokenAccessor.getAuthToken()).toBe('tok-123');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('signOut posts /auth/logout, clears token + query cache + state, and broadcasts to other tabs', async () => {
    const { api, tokenAccessor, queryClient, useAuthStore } = await loadModules();
    const clearSpy = vi.spyOn(queryClient, 'clear');
    vi.mocked(api.apiClient.post).mockResolvedValue({ success: true } as never);

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    await useAuthStore.getState().signOut();

    expect(api.apiClient.post).toHaveBeenCalledWith('/auth/logout', {});
    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(clearSpy).toHaveBeenCalled();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    const channel = MockBroadcastChannel.instances[0];
    expect(channel).toBeDefined();
    expect(channel.name).toBe('cc-auth');
    expect(channel.postMessage).toHaveBeenCalledWith({ type: 'logout' });
  });

  it('signOut flushes the signing-out user\'s pending analytics consent BEFORE clearing local state', async () => {
    // C2: on a shared browser, the flush must run while THIS account's token
    // is still live — one more delivery attempt before tokenAccessor/state get
    // wiped — otherwise an undelivered decision just sits there (or worse,
    // risks being touched by whichever account signs in next).
    const { api, tokenAccessor, consentSyncLib, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockResolvedValue({ success: true } as never);

    const callOrder: string[] = [];
    vi.mocked(consentSyncLib.flushAnalyticsConsentSync).mockImplementation(async () => {
      // Token must still be set when the flush fires.
      callOrder.push(tokenAccessor.getAuthToken() ? 'flush-with-token' : 'flush-without-token');
    });

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    vi.mocked(consentSyncLib.flushAnalyticsConsentSync).mockClear(); // drop the signIn call
    callOrder.length = 0; // mockClear() resets call history, not this closure array
    await useAuthStore.getState().signOut();

    expect(consentSyncLib.flushAnalyticsConsentSync).toHaveBeenCalledWith('user-1');
    expect(callOrder).toEqual(['flush-with-token']);
    // Local teardown still completes after the flush.
    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('signOut never flushes analytics consent when no user was signed in', async () => {
    const { api, consentSyncLib, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockResolvedValue({ success: true } as never);

    await useAuthStore.getState().signOut();

    expect(consentSyncLib.flushAnalyticsConsentSync).not.toHaveBeenCalled();
  });

  it('signOut still clears local state when the server logout fails', async () => {
    const { api, tokenAccessor, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('network down'));

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    await useAuthStore.getState().signOut();

    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(MockBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith({ type: 'logout' });
  });

  // The assertion above is not enough on its own: it only proves IN-MEMORY
  // state was torn down. The hint cookie is what survives a page reload, and
  // while the client never touched it, a logout whose request never landed
  // left it behind — so the next load refreshed the still-valid httpOnly
  // cookie and signed the user straight back in.
  it('signOut expires the session hint cookie even when the server logout fails', async () => {
    const { api, useAuthStore } = await loadModules();
    setSessionHint(true);
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('network down'));

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    await useAuthStore.getState().signOut();

    expect(document.cookie).not.toContain('cc_session=1');
  });

  it('a failed signOut does not leave a session that silently restores on the next load', async () => {
    const { api, useAuthStore } = await loadModules();
    setSessionHint(true);
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('network down'));

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    await useAuthStore.getState().signOut();

    // Simulate the next page load: a fresh module instance re-reads the cookie.
    vi.resetModules();
    vi.clearAllMocks();
    const { useAuthStore: reloaded, api: reloadedApi } = await loadModules();
    await reloaded.getState().bootstrap();

    // No hint left → bootstrap must not even attempt the refresh that would
    // resurrect the session from the untouched httpOnly cookie.
    expect(reloadedApi.apiClient.post).not.toHaveBeenCalledWith('/auth/refresh', {});
    expect(reloaded.getState().isAuthenticated).toBe(false);
  });

  it('a logout broadcast from another tab clears local state WITHOUT re-broadcasting', async () => {
    const { api, tokenAccessor, useAuthStore } = await loadModules();
    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);

    const channel = MockBroadcastChannel.instances[0];
    channel.onmessage?.({ data: { type: 'logout' } } as MessageEvent);

    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(channel.postMessage).not.toHaveBeenCalled();
    // No network logout for a remote-initiated teardown. (signIn above fires its
    // own /auth/session-established post, so this asserts the logout call
    // specifically rather than "no posts at all".)
    expect(api.apiClient.post).not.toHaveBeenCalledWith('/auth/logout', {});
  });

  it('bootstrap performs a silent cookie refresh and loads the current user', async () => {
    setSessionHint(true); // a returning user has the cc_session hint cookie
    const { api, tokenAccessor, posthogLib, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockResolvedValue({
      success: true,
      data: { session: { access_token: 'boot-token', expires_at: 999999 } },
    } as never);
    vi.mocked(api.apiClient.get).mockResolvedValue({
      success: true,
      data: { user: { ...testUser, notification_preferences: {}, created_at: '', updated_at: '' } },
    } as never);

    await useAuthStore.getState().bootstrap();

    expect(api.apiClient.post).toHaveBeenCalledWith('/auth/refresh', {});
    expect(api.apiClient.get).toHaveBeenCalledWith('/users/me');
    expect(tokenAccessor.getAuthToken()).toBe('boot-token');
    expect(posthogLib.identifyUser).toHaveBeenCalledWith('user-1', 'pat@example.com');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(testUser);
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });

  it('bootstrap reports session-established once the session is restored', async () => {
    setSessionHint(true);
    mockI18n.language = 'es';
    const { api, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockResolvedValue({
      success: true,
      data: { session: { access_token: 'boot-token' } },
    } as never);
    vi.mocked(api.apiClient.get).mockResolvedValue({
      success: true,
      data: { user: { ...testUser, notification_preferences: {}, created_at: '', updated_at: '' } },
    } as never);

    await useAuthStore.getState().bootstrap();

    expect(api.apiClient.post).toHaveBeenCalledWith('/auth/session-established', {
      language: 'es',
    });
  });

  it('bootstrap SKIPS the refresh call entirely when there is no session hint (first visit)', async () => {
    // No cc_session cookie → logged-out / first-time visitor. Bootstrap must not
    // touch the rate-limited /auth/refresh endpoint at all.
    const { api, tokenAccessor, useAuthStore } = await loadModules();

    await expect(useAuthStore.getState().bootstrap()).resolves.toBeUndefined();

    expect(api.apiClient.post).not.toHaveBeenCalled();
    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });

  it('bootstrap with a hint but a failing refresh (expired session) resolves silently as logged out', async () => {
    setSessionHint(true); // hint present, but the cookie session has expired
    const { api, tokenAccessor, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockRejectedValue({
      success: false,
      error: { code: 'REFRESH_FAILED' },
    });

    await expect(useAuthStore.getState().bootstrap()).resolves.toBeUndefined();

    expect(api.apiClient.post).toHaveBeenCalledWith('/auth/refresh', {});
    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
  });

  it('bootstrap is single-flight (StrictMode-safe)', async () => {
    setSessionHint(true); // need the hint so refresh is actually attempted
    const { api, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('no cookie'));

    await Promise.all([useAuthStore.getState().bootstrap(), useAuthStore.getState().bootstrap()]);

    expect(api.apiClient.post).toHaveBeenCalledTimes(1);
  });

  it('registers its signOut with the api client auth-failure hook', async () => {
    const { api } = await loadModules();
    expect(api.setOnAuthFailure).toHaveBeenCalledTimes(1);
    const handler = vi.mocked(api.setOnAuthFailure).mock.calls[0][0];
    expect(typeof handler).toBe('function');

    vi.mocked(api.apiClient.post).mockResolvedValue({ success: true } as never);
    await handler?.();
    // Auth failure → full sign-out (clears the stale cookie server-side too)
    expect(api.apiClient.post).toHaveBeenCalledWith('/auth/logout', {});
  });
});
