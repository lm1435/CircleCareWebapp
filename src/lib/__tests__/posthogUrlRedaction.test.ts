import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CREDENTIALS IN URLS NEVER REACH POSTHOG — NOT IN EVENTS, NOT ON THE PERSON.
 *
 * The leak this pins (proven end-to-end by
 * e2e/consent/granted-identify.consent.spec.ts): a consented user landing on
 * `/profile?access_token=eyJ…&refresh_token=…#refresh_token=…` had the RAW token
 * values stored on their PostHog PERSON, because posthog-js@1.386.6 writes
 * `$set` / `$set_once` (carrying `$current_url` / `$initial_current_url`) to the
 * TOP LEVEL of the `$identify` event, and `before_send` redacted
 * `event.properties` only. `mask_personal_data_properties` masks ad-click params
 * (gclid, fbclid) — not credentials. Person properties are permanent.
 *
 * Second defect pinned here: a generic `token=` / `code=` / `token_hash=` param
 * went out unredacted in every mode, because the redaction matched only the five
 * named OAuth params.
 *
 * Every test drives the REAL `before_send` handed to `posthog.init` — only
 * posthog-js itself is mocked.
 */

const init = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    set_config: vi.fn(),
    register: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
    identify: vi.fn(),
    captureException: vi.fn(),
  },
}));

type CaptureEvent = Record<string, unknown> & { event: string };
type BeforeSend = (event: CaptureEvent | null) => CaptureEvent | null;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Boot the real lib/posthog.ts with a key and the given consent; return its `before_send`. */
async function beforeSendFor(consented: boolean): Promise<BeforeSend> {
  init.mockClear();
  localStorage.clear();
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
  consent.setAnalyticsConsent(consented);
  posthog.initAnalytics();
  await loader.loadPosthogModule();
  await flush();
  expect(init).toHaveBeenCalledTimes(1);
  const options = init.mock.calls[0][1] as { before_send: BeforeSend };
  expect(typeof options.before_send).toBe('function');
  return options.before_send;
}

const FAKE_ACCESS = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl';
const FAKE_REFRESH = 'rfr-9f8e7d6c5b4a';
const FAKE_HASH_REFRESH = 'xyz-hash-refresh-77';
const TOKEN_URL =
  `https://my.circlecare.app/profile?tab=meds&access_token=${FAKE_ACCESS}` +
  `&refresh_token=${FAKE_REFRESH}&lang=es#refresh_token=${FAKE_HASH_REFRESH}&expires_in=3600`;
const REDACTED_TOKEN_URL =
  'https://my.circlecare.app/profile?tab=meds&access_token=[redacted]' +
  '&refresh_token=[redacted]&lang=es#refresh_token=[redacted]&expires_in=3600';
const SECRETS = [FAKE_ACCESS, FAKE_REFRESH, FAKE_HASH_REFRESH];

function expectNoSecrets(value: unknown, secrets: string[] = SECRETS): void {
  const json = JSON.stringify(value);
  for (const secret of secrets) expect(json, `leaked ${secret}`).not.toContain(secret);
}

describe.each([
  ['consenting (full)', true],
  ['declined (anonymous)', false],
])('before_send URL credential redaction — %s', (_label, consented) => {
  let beforeSend: BeforeSend;
  beforeEach(async () => {
    beforeSend = await beforeSendFor(consented);
  });

  it('$identify: top-level $set_once.$initial_current_url / $current_url are redacted (query AND hash)', () => {
    const out = beforeSend({
      event: '$identify',
      uuid: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      properties: { distinct_id: 'user-1', $current_url: TOKEN_URL },
      $set: { $current_url: TOKEN_URL },
      $set_once: {
        $initial_current_url: TOKEN_URL,
        $current_url: TOKEN_URL,
        $initial_pathname: '/profile',
        $session_entry_url: TOKEN_URL,
      },
      timestamp: new Date(0),
    });
    expect(out).not.toBeNull();
    expectNoSecrets(out);
    const setOnce = out!.$set_once as Record<string, string>;
    expect(setOnce.$initial_current_url).toBe(REDACTED_TOKEN_URL);
    expect(setOnce.$current_url).toBe(REDACTED_TOKEN_URL);
    expect(setOnce.$session_entry_url).toBe(REDACTED_TOKEN_URL);
    expect(setOnce.$initial_pathname).toBe('/profile');
    expect((out!.$set as Record<string, string>).$current_url).toBe(REDACTED_TOKEN_URL);
    // Envelope untouched.
    expect(out!.event).toBe('$identify');
    expect(out!.uuid).toBe('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b');
    expect(out!.timestamp).toEqual(new Date(0));
  });

  it('properties.$set / properties.$set_once variants are redacted', () => {
    const out = beforeSend({
      event: '$set',
      properties: {
        $set: { $current_url: TOKEN_URL, $referrer: `https://x.test/?token=${FAKE_REFRESH}` },
        $set_once: { $initial_current_url: TOKEN_URL, $initial_referrer: TOKEN_URL },
      },
    });
    expectNoSecrets(out);
    const props = out!.properties as Record<string, Record<string, string>>;
    expect(props.$set.$current_url).toBe(REDACTED_TOKEN_URL);
    expect(props.$set.$referrer).toBe('https://x.test/?token=[redacted]');
    expect(props.$set_once.$initial_current_url).toBe(REDACTED_TOKEN_URL);
  });

  it('$groupidentify $group_set and any *_url / *_referrer key are redacted', () => {
    const out = beforeSend({
      event: '$groupidentify',
      properties: { $group_set: { landing_url: TOKEN_URL } },
      $set_once: { $session_entry_referrer: TOKEN_URL, custom_referrer: TOKEN_URL },
    });
    expectNoSecrets(out);
  });

  it('$referrer / $initial_referrer / $session_entry_url carrying a token are redacted', () => {
    const out = beforeSend({
      event: '$pageview',
      properties: {
        $referrer: `https://my.circlecare.app/auth/callback#access_token=${FAKE_ACCESS}&type=recovery`,
        $initial_referrer: `https://my.circlecare.app/reset?token=${FAKE_REFRESH}`,
        $session_entry_url: `https://my.circlecare.app/x?token=${FAKE_HASH_REFRESH}`,
      },
    });
    expectNoSecrets(out);
    const props = out!.properties as Record<string, string>;
    expect(props.$referrer).toBe(
      'https://my.circlecare.app/auth/callback#access_token=[redacted]&type=[redacted]'
    );
    expect(props.$initial_referrer).toBe('https://my.circlecare.app/reset?token=[redacted]');
  });

  it.each([
    ['token', '?token=secret123'],
    ['code (query)', '?code=pkce-auth-code-1'],
    ['code (hash)', '#code=pkce-auth-code-1'],
    ['token_hash', '?token_hash=pkce_abc123&type=magiclink'],
    ['otp', '?otp=482913'],
    ['secret', '?secret=s3cr3t'],
    ['password', '?password=hunter2'],
    ['api_key', '?api_key=ak_live_1'],
    ['apikey', '?apikey=ak_live_1'],
    ['key', '?key=AIzaSyXX'],
    ['signature', '?signature=deadbeef'],
    ['sig', '?sig=deadbeef'],
    ['id_token', '#id_token=eyJid'],
    ['provider_token', '#provider_token=ya29.x'],
    ['provider_refresh_token', '#provider_refresh_token=1//0x'],
    ['UPPERCASE name', '?ACCESS_TOKEN=eyJupper'],
  ])('generic param %s is redacted, name kept', (_name, suffix) => {
    const url = `https://my.circlecare.app/cb${suffix}`;
    const out = beforeSend({
      event: 'custom',
      properties: { $current_url: url },
      $set_once: { $initial_current_url: url },
    });
    const value = suffix.split(/[=&]/)[1];
    expectNoSecrets(out, [value]);
    const name = suffix.slice(1).split('=')[0];
    expect((out!.properties as Record<string, string>).$current_url).toContain(`${name}=[redacted]`);
    expect((out!.$set_once as Record<string, string>).$initial_current_url).toContain(
      `${name}=[redacted]`
    );
  });

  it('non-sensitive params are kept byte-for-byte', () => {
    const url = 'https://my.circlecare.app/circles?tab=meds&lang=es&type=event#section=2';
    const out = beforeSend({
      event: '$pageview',
      properties: { $current_url: url },
      $set_once: { $initial_current_url: url },
    });
    expect((out!.properties as Record<string, string>).$current_url).toBe(url);
    expect((out!.$set_once as Record<string, string>).$initial_current_url).toBe(url);
  });

  it('names that merely CONTAIN a sensitive word are not redacted', () => {
    const url =
      'https://my.circlecare.app/x?tokenizer=1&keyboard=1&my_token=1&codec=h264' +
      '&signed=1&passwordless=1&monkey=1&otp_sent=1#keyframe=3&sigma=2';
    const out = beforeSend({ event: 'custom', properties: { $current_url: url } });
    expect((out!.properties as Record<string, string>).$current_url).toBe(url);
  });

  it('a callback URL percent-encoded inside redirect_to has its code redacted', () => {
    const url =
      'https://accounts.example/o?redirect_to=https%3A%2F%2Fmy.circlecare.app%2Fauth%2Fcallback' +
      '%3Fcode%3Dpkce-nested-code%26next%3D%2Fhome';
    const out = beforeSend({ event: 'custom', properties: { $referrer: url } });
    const ref = (out!.properties as Record<string, string>).$referrer;
    expect(ref).not.toContain('pkce-nested-code');
    expect(ref).toContain('code%3D[redacted]%26next%3D%2Fhome');
  });

  it('a malformed URL does not throw, the event is not dropped, and it is still redacted', () => {
    const malformed = `http://[::1/cb?token=${FAKE_REFRESH}%%&x=1#access_token=${FAKE_ACCESS}%zz`;
    let out: CaptureEvent | null = null;
    expect(() => {
      out = beforeSend({
        event: 'custom',
        properties: { $current_url: malformed, nested: [{ u: malformed }], n: 3, nil: null },
        $set_once: { $initial_current_url: malformed },
      });
    }).not.toThrow();
    expect(out).not.toBeNull();
    expectNoSecrets(out);
    const props = out!.properties as Record<string, unknown>;
    expect(props.$current_url).toBe('http://[::1/cb?token=[redacted]&x=1#access_token=[redacted]');
    expect(props.n).toBe(3);
    expect(props.nil).toBeNull();
  });

  it('invite codes are still redacted, including on the person payload', () => {
    const out = beforeSend({
      event: '$identify',
      properties: {},
      $set_once: { $initial_current_url: 'https://my.circlecare.app/invite/ABC123?lang=es' },
    });
    expect((out!.$set_once as Record<string, string>).$initial_current_url).toBe(
      'https://my.circlecare.app/invite/[redacted]?lang=es'
    );
  });
});

describe('anonymous-mode UUID masking still applies alongside URL redaction', () => {
  const CIRCLE = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';

  it('declined: UUIDs masked and *_id stripped in properties; UUIDs masked on $set_once; tokens redacted', async () => {
    const beforeSend = await beforeSendFor(false);
    const url = `https://my.circlecare.app/circles/${CIRCLE}/calendar?token=${FAKE_REFRESH}&tab=meds`;
    const out = beforeSend({
      event: 'custom',
      properties: { circle_id: CIRCLE, $current_url: url, distinct_id: 'anon-random' },
      $set_once: { $initial_current_url: url },
    });
    expectNoSecrets(out, [CIRCLE, FAKE_REFRESH]);
    const props = out!.properties as Record<string, string>;
    expect(props).not.toHaveProperty('circle_id');
    expect(props.distinct_id).toBe('anon-random');
    expect(props.$current_url).toBe(
      'https://my.circlecare.app/circles/[id]/calendar?token=[redacted]&tab=meds'
    );
    expect((out!.$set_once as Record<string, string>).$initial_current_url).toBe(
      'https://my.circlecare.app/circles/[id]/calendar?token=[redacted]&tab=meds'
    );
  });

  it('consenting: the circle UUID is kept (full mode) while the token is redacted', async () => {
    const beforeSend = await beforeSendFor(true);
    const url = `https://my.circlecare.app/circles/${CIRCLE}/calendar?token=${FAKE_REFRESH}`;
    const out = beforeSend({ event: 'custom', properties: { circle_id: CIRCLE, $current_url: url } });
    const props = out!.properties as Record<string, string>;
    expect(props.circle_id).toBe(CIRCLE);
    expect(props.$current_url).toBe(`https://my.circlecare.app/circles/${CIRCLE}/calendar?token=[redacted]`);
  });
});
