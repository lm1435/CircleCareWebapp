import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE PRIVACY OPTIONS HANDED TO `posthog.init`, in EVERY mode that constructs a
 * client.
 *
 * Two of them are load-bearing for promises made elsewhere and had no test:
 *
 *   - `persistence: 'memory'` — nothing written to cookies/localStorage. The
 *     consent copy's "session-only" / "never kept between visits" sentence and
 *     the whole of lib/analyticsMode.ts's web anonymous mode rest on it
 *     ("if anyone ever switches web to 'localStorage' ... this whole module has
 *     to be revisited").
 *   - `mask_personal_data_properties: true` — without it posthog-js records
 *     `$initial_person_info` with the landing URL verbatim, which on an OAuth
 *     return is `/auth/callback#access_token=…` (see the note in lib/posthog.ts).
 *
 * INIT IS NOT THE ONLY DOOR. posthog-js@1.386.6 also exposes `set_config`
 * (and `debug` / `startSessionRecording` / `stopSessionRecording`, which call
 * it internally), so a later `posthog.set_config({ persistence:
 * 'localStorage+cookie' })` would undo the init option. An earlier mock had no
 * `set_config` — the call threw after init, was swallowed by best-effort
 * catches, and the test stayed green. Every config-mutating method is a spy
 * here, and the EFFECTIVE config (init options folded with every `set_config`
 * call, in order) is asserted across a full lifecycle.
 *
 * Runs under BOTH `import.meta.env` modes (development and production), so a
 * production-only spread overriding `persistence` is exercised too.
 *
 * Boots the real lib/posthog.ts + lazy loader with a key configured; only
 * posthog-js itself is mocked.
 */

const init = vi.fn();
const setConfig = vi.fn();
const debug = vi.fn();
const startSessionRecording = vi.fn();
const stopSessionRecording = vi.fn();
const clearOptInOut = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    set_config: setConfig,
    debug,
    startSessionRecording,
    stopSessionRecording,
    clear_opt_in_out_capturing: clearOptInOut,
    register: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    captureException: vi.fn(),
  },
}));

const ENV_MODES = [
  ['development', { DEV: true, PROD: false, MODE: 'development' }],
  ['production', { DEV: false, PROD: true, MODE: 'production' }],
] as const;

function stubMode(mode: (typeof ENV_MODES)[number][1]): void {
  vi.stubEnv('DEV', mode.DEV);
  vi.stubEnv('PROD', mode.PROD);
  vi.stubEnv('MODE', mode.MODE);
}

beforeEach(() => {
  for (const spy of [init, setConfig, debug, startSessionRecording, stopSessionRecording, clearOptInOut]) {
    spy.mockClear();
  }
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
  vi.unstubAllEnvs();
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function bootFresh() {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: 'phc_test_key',
    },
  }));
  const consent = await import('@/lib/analyticsConsent');
  const posthog = await import('@/lib/posthog');
  const loader = await import('@/lib/posthogLoader');
  const decision = await import('@/lib/analyticsConsentDecision');
  return { consent, posthog, loader, decision };
}

async function initOptionsFor(consented: boolean): Promise<Record<string, unknown>> {
  const { consent, posthog, loader } = await bootFresh();
  consent.setAnalyticsConsent(consented);
  posthog.initAnalytics();
  await loader.loadPosthogModule();
  await flush();
  expect(init).toHaveBeenCalledTimes(1);
  expect(init.mock.calls[0][0]).toBe('phc_test_key');
  return init.mock.calls[0][1] as Record<string, unknown>;
}

/**
 * Boot with an answer, then walk every consent/identity transition the app
 * performs: identify, logout, withdraw or grant (through the real recorder the
 * signup + Profile surfaces use), logout again, flip back, logout again.
 */
async function runLifecycle(startConsented: boolean): Promise<void> {
  const { consent, posthog, loader, decision } = await bootFresh();
  consent.setAnalyticsConsent(startConsented);
  posthog.initAnalytics();
  await loader.loadPosthogModule();
  await flush();

  posthog.identifyUser('user-1'); // sign-in
  posthog.resetAnalytics(); // logout
  await flush();

  decision.recordAnalyticsConsentDecision(!startConsented, { id: 'user-1' }); // opt out / opt in
  await flush();
  posthog.identifyUser('user-1');
  posthog.resetAnalytics();
  await flush();

  decision.recordAnalyticsConsentDecision(startConsented, { id: 'user-2' }); // flip back
  await flush();
  posthog.identifyUser('user-2');
  posthog.resetAnalytics();
  posthog.disableAnalytics();
  await flush();
}

/** init options, then every `set_config` patch applied in call order. */
function effectiveConfig(): Record<string, unknown> {
  const initOptions = init.mock.calls.map((call) => (call[1] ?? {}) as Record<string, unknown>);
  const patches = setConfig.mock.calls.map((call) => (call[0] ?? {}) as Record<string, unknown>);
  // A repeat init is a no-op in posthog-js, so the FIRST init is the base.
  return Object.assign({}, initOptions[0], ...patches);
}

describe.each(ENV_MODES)('posthog.init privacy options (%s build)', (_modeName, mode) => {
  beforeEach(() => stubMode(mode));

  it.each([
    ['consenting (full)', true],
    ['declined (anonymous)', false],
  ])('%s: persistence is memory-only — nothing written to the device', async (_label, consented) => {
    const options = await initOptionsFor(consented);
    expect(options.persistence).toBe('memory');
  });

  it.each([
    ['consenting (full)', true],
    ['declined (anonymous)', false],
  ])('%s: masks the URL/referrer person properties', async (_label, consented) => {
    const options = await initOptionsFor(consented);
    expect(options.mask_personal_data_properties).toBe(true);
  });

  it.each([
    ['starts consenting', true],
    ['starts declined', false],
  ])(
    '%s: across the whole lifecycle no init or set_config leaves persistence non-memory or unmasks',
    async (_label, startConsented) => {
      await runLifecycle(startConsented);

      expect(init).toHaveBeenCalled();
      for (const [, options] of init.mock.calls as [string, Record<string, unknown>][]) {
        expect(options.persistence).toBe('memory');
        expect(options.mask_personal_data_properties).toBe(true);
      }
      for (const [patch] of setConfig.mock.calls as [Record<string, unknown>][]) {
        if ('persistence' in patch) expect(patch.persistence, 'set_config changed persistence').toBe('memory');
        if ('mask_personal_data_properties' in patch) {
          expect(patch.mask_personal_data_properties, 'set_config unmasked person properties').toBe(true);
        }
      }
      const effective = effectiveConfig();
      expect(effective.persistence).toBe('memory');
      expect(effective.mask_personal_data_properties).toBe(true);
    }
  );
});
