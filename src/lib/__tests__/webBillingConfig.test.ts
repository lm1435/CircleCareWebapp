import { afterEach, describe, expect, it, vi } from 'vitest';

// isWebBillingConfigured is a PURE env predicate, deliberately split out of
// lib/purchases.ts (which owns the ~177 KB gzip @revenuecat/purchases-js SDK)
// so the four modules that only need this boolean never pull the SDK into
// their import graph. This file asserts the predicate itself, independent of
// the SDK — see purchases.test.ts for the SDK-loading behavior.

async function loadWithKey(key: string | undefined) {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_REVENUECAT_WEB_BILLING_KEY: key,
    },
  }));
  return import('@/lib/webBillingConfig');
}

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('isWebBillingConfigured', () => {
  it('is false when the key is unset', async () => {
    const { isWebBillingConfigured } = await loadWithKey(undefined);
    expect(isWebBillingConfigured()).toBe(false);
  });

  it('is true when a sandbox key is set', async () => {
    const { isWebBillingConfigured } = await loadWithKey('rcb_sb_test123');
    expect(isWebBillingConfigured()).toBe(true);
  });

  it('is true when a live key is set', async () => {
    const { isWebBillingConfigured } = await loadWithKey('rcb_live_test123');
    expect(isWebBillingConfigured()).toBe(true);
  });
});
