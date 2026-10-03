// FORCED sign-out -> no stale error toast over /login (user-approved 2026-10-01,
// mobile twin: mobile/src/__tests__/store/forcedSignOutDialogs.test.tsx).
//
// A save that gets a 401 whose refresh then fails force-signs the user out via
// the api client's auth-failure hook (REAL authStore handler). The write's own
// onError then calls showToast('error'); the ToastProvider is mounted above the
// router, so without the guard the toast lands on /login. Real hook + real
// provider; only the api client and analytics are faked.
import { act, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('@/lib/posthog', () => ({ identifyUser: vi.fn(), resetAnalytics: vi.fn() }));
vi.mock('@/lib/analyticsConsentSync', () => ({
  flushAnalyticsConsentSync: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/i18n', () => ({ default: { language: 'en' } }));

const user = {
  id: 'user-1',
  email: 'a@example.com',
  first_name: 'A',
  last_name: null,
  provider: 'email',
} as never;

async function load() {
  const api = await import('@/lib/api');
  const { useAuthStore } = await import('@/store/authStore');
  const { ToastProvider, useToast } = await import('@/components/ui/Toast');
  const forced = await import('@/lib/forcedSignOut');
  forced.__resetForcedSignOutForTests();
  vi.mocked(api.apiClient.post).mockResolvedValue({ success: true } as never);
  const forceSignOut = async (): Promise<void> => {
    await vi.mocked(api.setOnAuthFailure).mock.calls[0][0]?.();
  };
  return { api, useAuthStore, ToastProvider, useToast, forceSignOut };
}

function mountConsumer(
  mods: Awaited<ReturnType<typeof load>>,
  captured: { show?: ReturnType<typeof mods.useToast>['showToast'] }
): void {
  function Consumer(): ReactElement {
    captured.show = mods.useToast().showToast;
    return <div />;
  }
  render(
    <mods.ToastProvider>
      <Consumer />
    </mods.ToastProvider>
  );
}

describe('forced sign-out suppresses stale error toasts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('a toast requested by a form mounted before the forced sign-out is dropped', async () => {
    const mods = await load();
    const cap: { show?: (m: string, t?: 'error') => void } = {};
    mountConsumer(mods, cap as never);
    await act(async () => {
      await mods.forceSignOut();
    });
    act(() => cap.show!('Could not save the note', 'error'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('without a forced sign-out the same error toast is shown', async () => {
    const mods = await load();
    const cap: { show?: (m: string, t?: 'error') => void } = {};
    mountConsumer(mods, cap as never);
    act(() => cap.show!('Could not save the note', 'error'));
    expect(screen.getByRole('alert').textContent).toContain('Could not save the note');
  });

  it('a voluntary sign-out does not suppress', async () => {
    const mods = await load();
    const cap: { show?: (m: string, t?: 'error') => void } = {};
    mountConsumer(mods, cap as never);
    await act(async () => {
      await mods.useAuthStore.getState().signOut();
    });
    act(() => cap.show!('Could not save the note', 'error'));
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('a consumer mounted AFTER the forced sign-out (the login page) still toasts', async () => {
    const mods = await load();
    await act(async () => {
      await mods.forceSignOut();
    });
    const cap: { show?: (m: string, t?: 'error') => void } = {};
    mountConsumer(mods, cap as never);
    act(() => cap.show!('Wrong password', 'error'));
    expect(screen.getByRole('alert').textContent).toContain('Wrong password');
  });

  it('after signing in again a consumer that outlived the sign-out toasts again', async () => {
    const mods = await load();
    const cap: { show?: (m: string, t?: 'error') => void } = {};
    mountConsumer(mods, cap as never);
    await act(async () => {
      await mods.forceSignOut();
    });
    act(() => cap.show!('dropped', 'error'));
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => mods.useAuthStore.getState().signIn({ access_token: 't2' } as never, user));
    act(() => cap.show!('shown', 'error'));
    expect(screen.getByRole('alert').textContent).toContain('shown');
  });
});
