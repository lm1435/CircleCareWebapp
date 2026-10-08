import {
  clearDailyUpdateStorage,
  dailyUpdateDismissKey,
  isDailyUpdateDismissed,
  markDailyUpdateDismissed,
  markDailyUpdateShown,
  wasDailyUpdateShown,
} from '../dailyUpdateStorage';

vi.mock('@/lib/posthog', () => ({ identifyUser: vi.fn(), resetAnalytics: vi.fn() }));
vi.mock('@/lib/analyticsConsentSync', () => ({
  flushAnalyticsConsentSync: vi.fn(() => Promise.resolve()),
}));

describe('daily update dismiss storage (plan §5.3 / §6)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('is per circle and per recipient-day', () => {
    markDailyUpdateDismissed('c1', '2026-10-08');
    expect(localStorage.getItem('circlecare:dailyUpdateDismissed:c1')).toBe('2026-10-08');
    expect(dailyUpdateDismissKey('c1')).toBe('circlecare:dailyUpdateDismissed:c1');
    expect(isDailyUpdateDismissed('c1', '2026-10-08')).toBe(true);
    // Another circle is unaffected; the next recipient-day brings the card back.
    expect(isDailyUpdateDismissed('c2', '2026-10-08')).toBe(false);
    expect(isDailyUpdateDismissed('c1', '2026-10-09')).toBe(false);
  });

  it('the "shown" marker is per circle per day too', () => {
    markDailyUpdateShown('c1', '2026-10-08');
    expect(wasDailyUpdateShown('c1', '2026-10-08')).toBe(true);
    expect(wasDailyUpdateShown('c1', '2026-10-09')).toBe(false);
  });

  it('survives storage that throws (private mode): reads as not dismissed, writes are no-ops', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => markDailyUpdateDismissed('c1', '2026-10-08')).not.toThrow();
    expect(isDailyUpdateDismissed('c1', '2026-10-08')).toBe(false);
    expect(() => clearDailyUpdateStorage()).not.toThrow();
  });

  it('clearDailyUpdateStorage removes every daily-update key and nothing else', () => {
    markDailyUpdateDismissed('c1', '2026-10-08');
    markDailyUpdateDismissed('c2', '2026-10-08');
    markDailyUpdateShown('c1', '2026-10-08');
    localStorage.setItem('cc_analytics_consent', 'granted');
    clearDailyUpdateStorage();
    expect(localStorage.getItem('circlecare:dailyUpdateDismissed:c1')).toBeNull();
    expect(localStorage.getItem('circlecare:dailyUpdateDismissed:c2')).toBeNull();
    expect(localStorage.getItem('circlecare:dailyUpdateShown:c1')).toBeNull();
    expect(localStorage.getItem('cc_analytics_consent')).toBe('granted');
  });

  it('sign-out clears it, so the next account on a shared browser starts clean', async () => {
    const api = await import('@/lib/api');
    const { useAuthStore } = await import('@/store/authStore');
    vi.mocked(api.apiClient.post).mockResolvedValue({ success: true } as never);
    useAuthStore
      .getState()
      .signIn({ access_token: 'tok' }, { id: 'u1', email: 'a@example.com', first_name: 'A', last_name: 'B' });
    markDailyUpdateDismissed('c1', '2026-10-08');
    await useAuthStore.getState().signOut();
    expect(localStorage.getItem('circlecare:dailyUpdateDismissed:c1')).toBeNull();
  });
});
