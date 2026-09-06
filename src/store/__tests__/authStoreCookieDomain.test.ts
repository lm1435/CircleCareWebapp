/**
 * @vitest-environment-options { "url": "https://my.circlecare.app/" }
 *
 * THE PRODUCTION PATH, which every other test in this suite misses.
 *
 * `clearSessionHintCookie()` has to expire a cookie the backend set with
 * `Domain=.circlecare.app` (COOKIE_DOMAIN — see backend/src/middleware/
 * webSession.ts), and a cookie delete only lands when Domain AND Path match
 * the ones it was set with. The rest of the suite runs under jsdom's default
 * `http://localhost/`, where the code takes its early return after the
 * host-only clear — so the domain-walking branch that actually runs in
 * production never executed in any test.
 *
 * This file pins the jsdom URL to the real web host so the parent-chain walk
 * is exercised for real. A mismatched Domain is a SILENT no-op (no error,
 * nothing thrown), which is precisely why it needs a test that reads the
 * cookie back rather than one that only checks the code ran.
 */

vi.mock('@/lib/posthog', () => ({
  identifyUser: vi.fn(),
  resetAnalytics: vi.fn(),
}));

vi.mock('@/lib/analyticsConsentSync', () => ({
  flushAnalyticsConsentSync: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/i18n', () => ({ default: { language: 'en' } }));

const testUser = {
  id: 'user-1',
  email: 'pat@example.com',
  first_name: 'Pat',
  last_name: 'Rivera',
};

async function loadStore() {
  const api = await import('@/lib/api');
  const { useAuthStore } = await import('@/store/authStore');
  return { api, useAuthStore };
}

/**
 * jsdom keeps ONE cookie jar for the whole file, so a cookie a test fails to
 * delete leaks into the next one and is read back as if that test had set it.
 * Without this, a broken domain walk fails the first test and then fails the
 * second for the WRONG reason (leftover from the first), which reads as two
 * bugs instead of one. Wipe both forms between tests so each assertion can
 * only be about the cookie its own test set.
 */
function wipeHintCookie(): void {
  const expired = 'cc_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/';
  document.cookie = expired;
  document.cookie = `${expired}; Domain=.circlecare.app`;
  document.cookie = `${expired}; Domain=.my.circlecare.app`;
}

describe('session hint cookie on the production domain', () => {
  beforeEach(() => {
    wipeHintCookie();
    expect(document.cookie).not.toContain('cc_session'); // isolation guard
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    wipeHintCookie();
  });

  it('runs on the real web host (guards the premise of this file)', () => {
    // If jsdom's URL ever stops being the prod host, the assertions below stop
    // testing the domain walk and quietly become duplicates of the localhost
    // tests. Fail loudly instead.
    expect(location.hostname).toBe('my.circlecare.app');
  });

  it('expires a hint cookie set with the production Domain=.circlecare.app', async () => {
    // Exactly how the backend sets it in production.
    document.cookie = 'cc_session=1; path=/; domain=.circlecare.app';
    expect(document.cookie).toContain('cc_session=1');

    const { api, useAuthStore } = await loadStore();
    // The server call fails — the case where only the client can clear it.
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('network down'));

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    await useAuthStore.getState().signOut();

    expect(document.cookie).not.toContain('cc_session=1');
  });

  it('also expires a host-only hint cookie (no Domain attribute)', async () => {
    document.cookie = 'cc_session=1; path=/';
    expect(document.cookie).toContain('cc_session=1');

    const { api, useAuthStore } = await loadStore();
    vi.mocked(api.apiClient.post).mockRejectedValue(new Error('network down'));

    useAuthStore.getState().signIn({ access_token: 'tok-123' }, testUser);
    await useAuthStore.getState().signOut();

    expect(document.cookie).not.toContain('cc_session=1');
  });
});
