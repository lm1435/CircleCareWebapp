import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';

// Unit tests for lib/pageview.ts — sanitizePath masking rules and the
// trackPageview capture (optional-key no-op + hash/search never captured).
// Mirrors the analytics.test.ts pattern: mock `posthog-js`, toggle the optional
// `VITE_POSTHOG_KEY` via a mocked `@/lib/env`, re-import per branch.

const capture = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture,
  },
}));

/** Import lib/pageview with VITE_POSTHOG_KEY set or unset. */
async function loadWithKey(key: string | undefined) {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: key,
    },
  }));
  // Prime the shared lazy-loader as if posthog-js were already loaded AND
  // configured, so trackPageview's capture below resolves SYNCHRONOUSLY,
  // matching this suite's assertions. Real queue/lazy-load behavior is
  // covered separately in posthogLoader.test.ts.
  const posthogModule = await import('posthog-js');
  const loader = await import('@/lib/posthogLoader');
  loader.__primePosthogForTests(posthogModule.default);

  return import('@/lib/pageview');
}

beforeEach(() => {
  // trackPageview is gated on consent as well as on the key.
  __resetAnalyticsConsentCache();
  setAnalyticsConsent(true);
  capture.mockClear();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('sanitizePath', () => {
  it('leaves plain static routes untouched', async () => {
    const { sanitizePath } = await loadWithKey(undefined);
    expect(sanitizePath('/')).toBe('/');
    expect(sanitizePath('/login')).toBe('/login');
    expect(sanitizePath('/circles')).toBe('/circles');
    expect(sanitizePath('/auth/callback')).toBe('/auth/callback');
    expect(sanitizePath('/reset-password')).toBe('/reset-password');
  });

  it('masks UUID segments as [id]', async () => {
    const { sanitizePath } = await loadWithKey(undefined);
    expect(sanitizePath('/circles/0bc0bd9e-1234-4abc-9def-1234567890ab')).toBe('/circles/[id]');
    // Uppercase UUIDs too
    expect(sanitizePath('/circles/0BC0BD9E-1234-4ABC-9DEF-1234567890AB')).toBe('/circles/[id]');
  });

  it('masks UUIDs in nested routes while keeping static sub-segments', async () => {
    const { sanitizePath } = await loadWithKey(undefined);
    expect(sanitizePath('/circles/0bc0bd9e-1234-4abc-9def-1234567890ab/calendar')).toBe(
      '/circles/[id]/calendar'
    );
    expect(sanitizePath('/circles/0bc0bd9e-1234-4abc-9def-1234567890ab/members')).toBe(
      '/circles/[id]/members'
    );
  });

  it('masks anything after /invite/ as [code], regardless of shape', async () => {
    const { sanitizePath } = await loadWithKey(undefined);
    expect(sanitizePath('/invite/AB12CD')).toBe('/invite/[code]');
    expect(sanitizePath('/invite/x9')).toBe('/invite/[code]');
    expect(sanitizePath('/invite/0bc0bd9e-1234-4abc-9def-1234567890ab')).toBe('/invite/[code]');
  });

  it('masks other obviously dynamic segments (numeric ids, long hex, long tokens)', async () => {
    const { sanitizePath } = await loadWithKey(undefined);
    expect(sanitizePath('/circles/12345/tasks')).toBe('/circles/[id]/tasks');
    expect(sanitizePath('/documents/9f8e7d6c5b4a39281706f5e4d3c2b1a0')).toBe('/documents/[id]');
    expect(sanitizePath('/verify/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9')).toBe('/verify/[id]');
  });

  it('defensively strips query and hash if a caller ever passes them', async () => {
    const { sanitizePath } = await loadWithKey(undefined);
    expect(sanitizePath('/login?next=%2Fcircles')).toBe('/login');
    expect(sanitizePath('/auth/callback#access_token=secret')).toBe('/auth/callback');
    expect(sanitizePath('/invite/AB12CD?utm_source=email#x')).toBe('/invite/[code]');
  });
});

describe('trackPageview', () => {
  it('no-ops when VITE_POSTHOG_KEY is unset', async () => {
    const { trackPageview } = await loadWithKey(undefined);
    trackPageview('/login');
    expect(capture).not.toHaveBeenCalled();
  });

  it('captures $pageview with the sanitized pathname and rebuilt $current_url', async () => {
    const { trackPageview } = await loadWithKey('phc_test_key');
    trackPageview('/circles/0bc0bd9e-1234-4abc-9def-1234567890ab/calendar');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('$pageview', {
      $current_url: `${window.location.origin}/circles/[id]/calendar`,
      $pathname: '/circles/[id]/calendar',
    });
  });

  it('never includes hash or search in any captured property', async () => {
    const { trackPageview } = await loadWithKey('phc_test_key');
    trackPageview('/auth/callback?state=abc#access_token=super-secret');
    const [, props] = capture.mock.calls[0] as [string, Record<string, string>];
    for (const value of Object.values(props)) {
      expect(value).not.toContain('?');
      expect(value).not.toContain('#');
      expect(value).not.toContain('secret');
    }
    expect(props.$pathname).toBe('/auth/callback');
  });
});
