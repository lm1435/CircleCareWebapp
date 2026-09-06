import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Real lazy-load + queue behavior of lib/posthogLoader.ts — the shared
// primitive lib/posthog.ts, lib/analytics.ts and lib/pageview.ts all route
// their posthog-js calls through. Unlike analytics.test.ts / pageview.test.ts
// (which prime the loader as already-ready so THEIR OWN gating/sanitization
// logic can be asserted synchronously), this file exercises the actual
// dynamic-import + queue mechanics with nothing pre-primed.

const capture = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture,
    identify: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    captureException: vi.fn(),
  },
}));

beforeEach(() => {
  vi.resetModules();
  capture.mockClear();
});

describe('posthogLoader — queueing before load', () => {
  it('queues an action fired before the SDK loads, and never calls it just because the module fetched', async () => {
    const { withPosthog, loadPosthogModule } = await import('@/lib/posthogLoader');

    withPosthog((ph) => ph.capture('queued_event'));
    // Fetch not even started to resolve yet from this test's perspective —
    // definitely not delivered.
    expect(capture).not.toHaveBeenCalled();

    // Loading the module alone (without `markPosthogReady`) must NOT flush —
    // a capture must never reach an instance that hasn't been configured.
    await loadPosthogModule();
    expect(capture).not.toHaveBeenCalled();
  });

  it('delivers a queued action once the loader is marked ready', async () => {
    const { withPosthog, loadPosthogModule, markPosthogReady } = await import(
      '@/lib/posthogLoader'
    );

    withPosthog((ph) => ph.capture('queued_event'));
    expect(capture).not.toHaveBeenCalled();

    const instance = await loadPosthogModule();
    markPosthogReady(instance);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith('queued_event');
  });

  it('runs an action immediately, with no queueing, once already ready', async () => {
    const { withPosthog, loadPosthogModule, markPosthogReady } = await import(
      '@/lib/posthogLoader'
    );
    const instance = await loadPosthogModule();
    markPosthogReady(instance);
    capture.mockClear();

    withPosthog((ph) => ph.capture('immediate_event'));
    expect(capture).toHaveBeenCalledWith('immediate_event');
  });

  it('flushes multiple queued actions in the order they arrived', async () => {
    const { withPosthog, loadPosthogModule, markPosthogReady } = await import(
      '@/lib/posthogLoader'
    );
    const order: string[] = [];
    withPosthog(() => order.push('first'));
    withPosthog(() => order.push('second'));
    withPosthog(() => order.push('third'));

    const instance = await loadPosthogModule();
    markPosthogReady(instance);

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('a queued action that throws does not block the rest of the queue, and never throws out', async () => {
    const { withPosthog, loadPosthogModule, markPosthogReady } = await import(
      '@/lib/posthogLoader'
    );
    const ran: string[] = [];
    withPosthog(() => {
      throw new Error('boom');
    });
    withPosthog(() => ran.push('after'));

    const instance = await loadPosthogModule();
    expect(() => markPosthogReady(instance)).not.toThrow();
    expect(ran).toEqual(['after']);
  });

  it('never re-attempts a fetch that already succeeded — the fix must not break the happy path', async () => {
    const { loadPosthogModule } = await import('@/lib/posthogLoader');
    const first = await loadPosthogModule();
    const second = await loadPosthogModule();
    expect(second).toBe(first);
  });
});

describe('posthogLoader — consentControl queue entries are dropped, never replayed', () => {
  it('markPosthogReady never runs a consentControl-kind entry (reset/disable)', async () => {
    const { withPosthog, loadPosthogModule, markPosthogReady } = await import(
      '@/lib/posthogLoader'
    );
    const resetRan = vi.fn();
    const captureRan = vi.fn();
    withPosthog(resetRan, 'consentControl');
    withPosthog(captureRan, 'capture');

    const instance = await loadPosthogModule();
    markPosthogReady(instance);

    // This is the actual fix: a reset/opt-out queued under an OLDER consent
    // decision must never fire once `configure()` has freshly decided the
    // CURRENT one — only ordinary capture-kind entries flush.
    expect(resetRan).not.toHaveBeenCalled();
    expect(captureRan).toHaveBeenCalledTimes(1);
  });

  it('clearPendingQueue drops everything (capture AND consentControl) without marking ready', async () => {
    const { withPosthog, clearPendingQueue, loadPosthogModule } = await import(
      '@/lib/posthogLoader'
    );
    const captureRan = vi.fn();
    withPosthog(captureRan, 'capture');
    await loadPosthogModule();

    clearPendingQueue();

    // Queue is empty and NOTHING was marked ready — a later `withPosthog` call
    // must still queue (not run immediately against an unconfigured instance).
    const laterRan = vi.fn();
    withPosthog(laterRan, 'capture');
    expect(captureRan).not.toHaveBeenCalled();
    expect(laterRan).not.toHaveBeenCalled();
  });
});

describe('posthogLoader — a rejected import is not cached forever', () => {
  it('retries the fetch on the next call instead of replaying the same rejection', async () => {
    vi.resetModules();
    let attempt = 0;
    vi.doMock('posthog-js', () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('chunk load failed');
      }
      return {
        default: {
          init: vi.fn(),
          register: vi.fn(),
          capture: vi.fn(),
        },
      };
    });

    const { loadPosthogModule } = await import('@/lib/posthogLoader');

    // vitest wraps whatever a mock factory throws in its own generic "there
    // was an error mocking a module" message, so the ORIGINAL message isn't
    // asserted here — the load-bearing assertion is `attempt` below, which
    // proves a genuinely NEW import() happened rather than a cached rejection
    // being replayed.
    await expect(loadPosthogModule()).rejects.toBeInstanceOf(Error);
    expect(attempt).toBe(1);

    // A second call must RE-ATTEMPT the import, not return the same cached
    // rejection — otherwise one bad fetch (a chunk 404 after a redeploy)
    // bricks analytics/checkout for the rest of the tab's lifetime.
    await expect(loadPosthogModule()).resolves.toBeDefined();
    expect(attempt).toBe(2);

    vi.doUnmock('posthog-js');
  });
});

describe('posthog.ts bundle guard', () => {
  it('never statically imports posthog-js — only via posthogLoader’s dynamic import()', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/posthog.ts'), 'utf8');
    // A top-level (column-0) `import ... from 'posthog-js'` statement would
    // pull the ~64 KB gzip SDK into the entry chunk.
    expect(source).not.toMatch(/^import\b[\s\S]*?from\s+['"]posthog-js['"]/m);
  });
});

describe('main.tsx bundle guard', () => {
  it('does not call initAnalytics synchronously before render', () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    // A bare top-level `initAnalytics();` would run before first paint,
    // forcing the lazily-loaded posthog-js fetch to start immediately and
    // defeating the point of deferring it — it must only be reachable from
    // inside a requestIdleCallback/setTimeout callback.
    expect(source).not.toMatch(/^\s*initAnalytics\(\);?\s*$/m);
    expect(source).toMatch(/requestIdleCallback/);
    expect(source).toMatch(/setTimeout\(\(\) => initAnalytics\(\)/);
  });
});
