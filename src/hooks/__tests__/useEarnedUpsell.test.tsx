import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const status = vi.hoisted(() => ({ data: undefined as unknown }));
const auth = vi.hoisted(() => ({ userId: 'owner-1' as string | undefined }));

vi.mock('@/hooks/useSubscriptionStatus', () => ({
  useSubscriptionStatus: () => ({ data: status.data }),
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) =>
    sel({ user: auth.userId ? { id: auth.userId } : null }),
}));
vi.mock('@/api/subscriptionStatus', () => ({ recordUpsellEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/analytics', () => ({
  Analytics: {
    upsellEligible: vi.fn(),
    upsellSuppressed: vi.fn(),
    upsellShown: vi.fn(),
    upsellDismissed: vi.fn(),
    upsellCtaTapped: vi.fn(),
  },
}));

import { Analytics } from '@/lib/analytics';
import { recordUpsellEvent } from '@/api/subscriptionStatus';
import { useEarnedUpsell } from '@/hooks/useEarnedUpsell';
import {
  notifyEarnedPaywallAccepted,
  notifyEarnedPaywallDismissed,
  resetEarnedUpsellSession,
} from '@/lib/earnedUpsellSession';

const eligible = (trigger: 'meds_confirmed' | 'invite_accepted' = 'invite_accepted') => ({
  upsell: { eligible: true, trigger, reason: null, impressionNumber: 2 },
});
const suppressed = (reason: string) => ({
  upsell: { eligible: false, trigger: null, reason, impressionNumber: 0 },
});

let path = '/circles/c1';
let navState: unknown = null;
function Probe(): null {
  const loc = useLocation();
  path = loc.pathname;
  navState = loc.state;
  return null;
}

function setup(initialEnabled = true) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(
      QueryClientProvider,
      { client },
      createElement(MemoryRouter, { initialEntries: ['/circles/c1'] }, createElement(Probe), children)
    );
  return renderHook(({ enabled }) => useEarnedUpsell(enabled), {
    wrapper,
    initialProps: { enabled: initialEnabled },
  });
}

const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(1000); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetEarnedUpsellSession();
  status.data = undefined;
  auth.userId = 'owner-1';
  path = '/circles/c1';
  navState = null;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useEarnedUpsell', () => {
  it('eligible owner: records the impression and opens /upgrade in the earned context', async () => {
    status.data = eligible('invite_accepted');
    setup();
    await settle();
    expect(path).toBe('/upgrade');
    expect(navState).toEqual({ paywallContext: 'earned_invite' });
    expect(recordUpsellEvent).toHaveBeenCalledWith('shown', 'invite_accepted');
    expect(Analytics.upsellShown).toHaveBeenCalledWith('invite_accepted', 2);
    expect(Analytics.upsellEligible).toHaveBeenCalledTimes(1);
  });

  it('meds_confirmed maps to earned_meds', async () => {
    status.data = eligible('meds_confirmed');
    setup();
    await settle();
    expect(navState).toEqual({ paywallContext: 'earned_meds' });
  });

  it('not enabled (member / wizard open): never asks and records nothing', async () => {
    status.data = eligible();
    setup(false);
    await settle();
    expect(path).toBe('/circles/c1');
    expect(recordUpsellEvent).not.toHaveBeenCalled();
  });

  it('server says not eligible: never asks, reports the suppression reason once', async () => {
    status.data = suppressed('cap_reached');
    const { rerender } = setup();
    await settle();
    rerender({ enabled: true });
    await settle();
    expect(path).toBe('/circles/c1');
    expect(recordUpsellEvent).not.toHaveBeenCalled();
    expect(Analytics.upsellSuppressed).toHaveBeenCalledTimes(1);
    expect(Analytics.upsellSuppressed).toHaveBeenCalledWith('cap_reached');
  });

  it('no upsell field (older backend): nothing happens', async () => {
    status.data = { tier: 'free' };
    setup();
    await settle();
    expect(path).toBe('/circles/c1');
  });

  it('once per session: a second mount does not ask again or double-count the impression', async () => {
    status.data = eligible();
    setup();
    await settle();
    expect(recordUpsellEvent).toHaveBeenCalledTimes(1);
    setup();
    await settle();
    expect(recordUpsellEvent).toHaveBeenCalledTimes(1);
    expect(Analytics.upsellShown).toHaveBeenCalledTimes(1);
  });

  it('a different account in the same tab is asked (the guard is per user)', async () => {
    status.data = eligible();
    setup();
    await settle();
    auth.userId = 'owner-2';
    setup();
    await settle();
    expect(recordUpsellEvent).toHaveBeenCalledTimes(2);
  });

  it('yields to an open dialog at fire time and does not burn the impression', async () => {
    status.data = eligible();
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    document.body.appendChild(d);
    setup();
    await settle();
    expect(path).toBe('/circles/c1');
    expect(recordUpsellEvent).not.toHaveBeenCalled();
  });

  it('asks once the safe moment arrives (enabled flips true)', async () => {
    status.data = eligible();
    const { rerender } = setup(false);
    await settle();
    expect(path).toBe('/circles/c1');
    rerender({ enabled: true });
    await settle();
    expect(path).toBe('/upgrade');
  });

  it('closing the earned paywall writes the durable dismissal exactly once; a buy tap does not', async () => {
    status.data = eligible('invite_accepted');
    setup();
    await settle();
    notifyEarnedPaywallAccepted('earned_invite');
    expect(Analytics.upsellCtaTapped).toHaveBeenCalledWith('invite_accepted', 2);
    expect(recordUpsellEvent).not.toHaveBeenCalledWith('dismissed', expect.anything());
    notifyEarnedPaywallDismissed('earned_invite');
    notifyEarnedPaywallDismissed('earned_invite');
    expect(recordUpsellEvent).toHaveBeenCalledWith('dismissed', 'invite_accepted');
    expect(recordUpsellEvent).toHaveBeenCalledTimes(2); // shown + dismissed once
    expect(Analytics.upsellDismissed).toHaveBeenCalledTimes(1);
  });

  it('closing a NON-earned paywall never writes an upsell dismissal', async () => {
    status.data = eligible();
    setup();
    await settle();
    notifyEarnedPaywallDismissed('capacity');
    notifyEarnedPaywallDismissed('general');
    expect(recordUpsellEvent).toHaveBeenCalledTimes(1);
    expect(Analytics.upsellDismissed).not.toHaveBeenCalled();
  });
});
