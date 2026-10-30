import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `$exception` (capture_exceptions) can carry free text from the error
 * message. The REAL before_send posthog is initialized with must scrub it in
 * both consent modes; other events untouched; nothing throws.
 */
const init = vi.fn();
vi.mock('posthog-js', () => ({
  default: {
    init,
    register: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    captureException: vi.fn(),
  },
}));

type BeforeSend = (event: any) => any;

async function boot(consent: boolean): Promise<BeforeSend> {
  vi.resetModules();
  vi.doMock('@/lib/env', () => ({
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'anon',
      VITE_API_URL: 'http://localhost:3000',
      VITE_POSTHOG_KEY: 'phc_test_key',
    },
  }));
  const posthog = await import('@/lib/posthog');
  const consentMod = await import('@/lib/analyticsConsent');
  const loader = await import('@/lib/posthogLoader');
  consentMod.setAnalyticsConsent(consent);
  posthog.initAnalytics();
  await loader.loadPosthogModule();
  await new Promise((r) => setTimeout(r, 0));
  return (init.mock.calls.at(-1)![1] as { before_send: BeforeSend }).before_send;
}

const MSG =
  "Cannot read 'Metformin 500mg' of null for jane.doe@example.com token " +
  'abc123def456ghi789jkl012 order 123456789 "my private note" `x`';

const exceptionEvent = () => ({
  event: '$exception',
  properties: {
    $exception_message: MSG,
    $exception_values: [MSG],
    $exception_steps: [{ $message: 'user typed Metformin' }],
    $exception_list: [
      {
        type: 'TypeError',
        value: MSG,
        stacktrace: {
          type: 'raw',
          frames: [
            {
              filename: 'app/pages/Meds.tsx',
              function: 'saveMed',
              lineno: 42,
              context_line: 'const name = "Metformin";',
              pre_context: ['a'],
              post_context: ['b'],
            },
          ],
        },
      },
    ],
  },
});

beforeEach(() => {
  init.mockClear();
  localStorage.clear();
});

describe.each([
  ['consented', true],
  ['anonymous', false],
])('before_send (%s) scrubs $exception', (_name, consent) => {
  it('scrubs message fields, keeps type and frame code, drops context lines', async () => {
    const beforeSend = await boot(consent);
    const out = beforeSend(exceptionEvent());
    const json = JSON.stringify(out);
    for (const leak of ['Metformin', 'jane.doe', 'abc123def456', '123456789', 'private note']) {
      expect(json).not.toContain(leak);
    }
    const p = out.properties;
    expect(p.$exception_message).toContain('[redacted]');
    expect(p.$exception_message).toContain('[email]');
    expect(p.$exception_message).toContain('#');
    expect(p.$exception_values[0]).toBe(p.$exception_message);
    expect(p.$exception_steps).toBeUndefined();
    const entry = p.$exception_list[0];
    expect(entry.type).toBe('TypeError');
    const frame = entry.stacktrace.frames[0];
    expect(frame).toMatchObject({ filename: 'app/pages/Meds.tsx', function: 'saveMed', lineno: 42 });
    expect(frame.context_line).toBeUndefined();
    expect(frame.pre_context).toBeUndefined();
    expect(frame.post_context).toBeUndefined();
  });

  it('leaves other events untouched', async () => {
    const beforeSend = await boot(consent);
    const ev = { event: 'med_logged', properties: { note: "it's 123456 'x'", n: 5 } };
    expect(beforeSend(ev).properties).toEqual(ev.properties);
  });

  it('does not throw on malformed payloads', async () => {
    const beforeSend = await boot(consent);
    const bad = [
      { event: '$exception' },
      { event: '$exception', properties: null },
      { event: '$exception', properties: { $exception_list: 'x', $exception_values: 5 } },
      { event: '$exception', properties: { $exception_list: [null, 3, { value: 7 }] } },
      { event: '$exception', properties: { $exception_message: 12 } },
    ];
    for (const ev of bad) expect(() => beforeSend(ev)).not.toThrow();
    expect(beforeSend(bad[2]).properties.$exception_list).toBeUndefined();
  });
});

describe('crash events are unlinked from the person in the CONSENTED mode', () => {
  const crashProps = () => ({
    distinct_id: 'user-uuid-1',
    $device_id: 'dev-1',
    $session_id: 'sess-1',
    $user_id: 'user-uuid-1',
    $anon_distinct_id: 'anon-1',
    $is_identified: true,
    circle_id: '11111111-2222-3333-4444-555555555555',
    app_version: '1.3.1',
    $os: 'iOS',
    $set: { email: 'a@b.co' },
    $set_once: { x: 1 },
  });

  it.each([
    ['$exception', {}],
    ['error_occurred', { fatal: true, error: "bad 'Metformin' x@y.co" }],
  ])('%s', async (name, extra) => {
    const beforeSend = await boot(true);
    const out = beforeSend({ event: name, $set: { email: 'a@b.co' }, properties: { ...crashProps(), ...extra } });
    const p = out.properties;
    expect(p.distinct_id).not.toBe('user-uuid-1');
    expect(p.distinct_id).toMatch(/^crash-/);
    expect(p.$process_person_profile).toBe(false);
    expect(p.$is_identified).toBe(false);
    for (const k of ['circle_id', '$device_id', '$session_id', '$user_id', '$anon_distinct_id', '$set', '$set_once']) {
      expect(p[k]).toBeUndefined();
    }
    expect(out.$set).toBeUndefined();
    expect(p.app_version).toBe('1.3.1');
    expect(p.$os).toBe('iOS');
    expect(JSON.stringify(out)).not.toMatch(/Metformin|x@y\.co|a@b\.co/);
  });

  it('a non-fatal error_occurred and normal events keep identity', async () => {
    const beforeSend = await boot(true);
    const out = beforeSend({ event: 'error_occurred', properties: { ...crashProps(), fatal: false } });
    expect(out.properties.distinct_id).toBe('user-uuid-1');
    expect(out.properties.circle_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(out.properties.$process_person_profile).toBeUndefined();
  });
});
