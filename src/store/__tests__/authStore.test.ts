// Task 50 (store half) — authStore: signIn/bootstrap/signOut, cross-tab
// broadcast, onAuthFailure registration. `@/lib/api` is mocked by the global
// test setup; modules are re-imported per test so module-level state
// (BroadcastChannel, bootstrap single-flight) starts fresh.

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
  const { useAuthStore } = await import('@/store/authStore');
  return { api, tokenAccessor, queryClient, useAuthStore };
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
    const { tokenAccessor, useAuthStore } = await loadModules();

    useAuthStore.getState().signIn({ access_token: 'tok-123', expires_at: 1234567890 }, testUser);

    expect(tokenAccessor.getAuthToken()).toBe('tok-123');
    expect(tokenAccessor.getExpiresAt()).toBe(1234567890);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(testUser);
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
    // Web threat model: nothing auth-related may touch JS-readable storage.
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
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

  it('signOut still clears local state when the server logout fails', async () => {
    const { api, tokenAccessor, useAuthStore } = await loadModules();
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('network down'));

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    await useAuthStore.getState().signOut();

    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(MockBroadcastChannel.instances[0].postMessage).toHaveBeenCalledWith({ type: 'logout' });
  });

  it('a logout broadcast from another tab clears local state WITHOUT re-broadcasting', async () => {
    const { api, tokenAccessor, useAuthStore } = await loadModules();
    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);

    const channel = MockBroadcastChannel.instances[0];
    channel.onmessage?.({ data: { type: 'logout' } } as MessageEvent);

    expect(tokenAccessor.getAuthToken()).toBeNull();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(channel.postMessage).not.toHaveBeenCalled();
    // No network logout for a remote-initiated teardown
    expect(api.apiClient.post).not.toHaveBeenCalled();
  });

  it('bootstrap performs a silent cookie refresh and loads the current user', async () => {
    setSessionHint(true); // a returning user has the cc_session hint cookie
    const { api, tokenAccessor, useAuthStore } = await loadModules();
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
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(useAuthStore.getState().user).toEqual(testUser);
    expect(useAuthStore.getState().isBootstrapping).toBe(false);
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
