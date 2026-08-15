import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit tests for the web analytics wrapper (lib/analytics.ts) + the identify /
// reset helpers (lib/posthog.ts). We mock `posthog-js` and toggle the optional
// `VITE_POSTHOG_KEY` via a mocked `@/lib/env` so we can assert BOTH:
//   (a) every call no-ops safely when PostHog isn't configured, and
//   (b) when configured, the right event name + PHI-free props reach
//       posthog.capture / identify / reset.
//
// Modules read `env` at call time (analytics.ts) and `env.VITE_POSTHOG_KEY` is
// the same gate `initAnalytics` uses, so flipping the mock + re-importing the
// module under test exercises each branch independently.

const capture = vi.fn();
const identify = vi.fn();
const reset = vi.fn();
const init = vi.fn();
const register = vi.fn();
const captureExceptionSpy = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    register,
    capture,
    identify,
    reset,
    captureException: captureExceptionSpy,
  },
}));

/** Import lib/analytics + lib/posthog with VITE_POSTHOG_KEY set or unset. */
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
  const analytics = await import('@/lib/analytics');
  const posthog = await import('@/lib/posthog');
  return {
    Analytics: analytics.Analytics,
    sanitizeErrorText: analytics.sanitizeErrorText,
    ...posthog,
  };
}

beforeEach(() => {
  capture.mockClear();
  identify.mockClear();
  reset.mockClear();
  init.mockClear();
  register.mockClear();
  captureExceptionSpy.mockClear();
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('analytics wrapper — optional / no-op path', () => {
  it('does NOT call posthog.capture when VITE_POSTHOG_KEY is unset', async () => {
    const { Analytics } = await loadWithKey(undefined);
    Analytics.circleCreated(true);
    Analytics.medicationConfirmed('c1', 'taken');
    Analytics.logout();
    Analytics.onboardingStarted();
    Analytics.onboardingFlowCompleted('created');
    expect(capture).not.toHaveBeenCalled();
  });

  it('identifyUser / resetAnalytics no-op when key is unset', async () => {
    const { identifyUser, resetAnalytics } = await loadWithKey(undefined);
    identifyUser('user-1');
    identifyUser('user-1', 'pat@example.com');
    resetAnalytics();
    expect(identify).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
});

describe('analytics wrapper — active path (key set)', () => {
  it('circle_created carries only the is_self_care boolean (no PHI)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.circleCreated(true);
    expect(capture).toHaveBeenCalledWith('circle_created', { is_self_care: true });
  });

  it('medication_confirmed carries circle_id + status enum only', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.medicationConfirmed('circle-123', 'taken_late');
    expect(capture).toHaveBeenCalledWith('medication_confirmed', {
      circle_id: 'circle-123',
      status: 'taken_late',
    });
  });

  it('event_created carries circle_id, event_type enum, recurring boolean', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.eventCreated('circle-123', 'medication', false);
    expect(capture).toHaveBeenCalledWith('event_created', {
      circle_id: 'circle-123',
      event_type: 'medication',
      recurring: false,
    });
  });

  it('signup_failed carries method + error code only', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.signupFailed('email', 'USER_EXISTS');
    expect(capture).toHaveBeenCalledWith('signup_failed', {
      method: 'email',
      error: 'USER_EXISTS',
    });
  });

  it('invite_sent carries circle_id + role (never an email)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.inviteSent('circle-123', 'caregiver');
    expect(capture).toHaveBeenCalledWith('invite_sent', {
      circle_id: 'circle-123',
      role: 'caregiver',
    });
  });

  it('document_uploaded carries circle_id, category, file_type (no label)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.documentUploaded('circle-123', 'medical_records', 'pdf');
    expect(capture).toHaveBeenCalledWith('document_uploaded', {
      circle_id: 'circle-123',
      category: 'medical_records',
      file_type: 'pdf',
    });
  });

  it('vital_logged carries circle_id + vital_type (never the value)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.vitalLogged('circle-123', 'blood_pressure');
    expect(capture).toHaveBeenCalledWith('vital_logged', {
      circle_id: 'circle-123',
      vital_type: 'blood_pressure',
    });
  });

  it('ai_chat_message_sent carries no message text — only a length', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.aiChatMessageSent('circle-123', { turnIndex: 0, messageLength: 27 });
    expect(capture).toHaveBeenCalledWith('ai_chat_message_sent', {
      circle_id: 'circle-123',
      turn_index: 0,
      message_length: 27,
      used_suggestion: false,
    });
  });

  it('ai_chat_message_sent flags a tapped suggestion chip (mobile parity)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.aiChatMessageSent('circle-123', {
      turnIndex: 0,
      messageLength: 27,
      usedSuggestion: true,
    });
    expect(capture).toHaveBeenCalledWith(
      'ai_chat_message_sent',
      expect.objectContaining({ used_suggestion: true })
    );
  });

  it('ai_chat_response_received carries the classified intent', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.aiChatResponseReceived('circle-123', {
      intent: 'GET_ADHERENCE',
      latencyMs: 640,
      turnIndex: 1,
    });
    expect(capture).toHaveBeenCalledWith('ai_chat_response_received', {
      circle_id: 'circle-123',
      intent: 'GET_ADHERENCE',
      latency_ms: 640,
      turn_index: 1,
    });
  });

  it('ai_chat_failed separates rate limits from other errors', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.aiChatFailed('circle-123', {
      reason: 'rateLimited',
      latencyMs: 90,
      turnIndex: 0,
    });
    expect(capture).toHaveBeenCalledWith('ai_chat_failed', {
      circle_id: 'circle-123',
      reason: 'rateLimited',
      latency_ms: 90,
      turn_index: 0,
    });
  });

  it('onboarding_started carries no properties (count-only funnel event)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.onboardingStarted();
    expect(capture).toHaveBeenCalledWith('onboarding_started', undefined);
  });

  it('onboarding_flow_completed carries the path enum + $set_once onboarded_at ISO string', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.onboardingFlowCompleted('joined');
    expect(capture).toHaveBeenCalledTimes(1);
    const [event, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('onboarding_flow_completed');
    expect(props.path).toBe('joined');
    const setOnce = props.$set_once as { onboarded_at: string };
    expect(setOnce.onboarded_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    // Sanity: parses back to a valid recent date.
    expect(Number.isNaN(Date.parse(setOnce.onboarded_at))).toBe(false);
  });

  it('calendar_viewed carries circle_id + view enum', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.calendarViewed('circle-123', 'week');
    expect(capture).toHaveBeenCalledWith('calendar_viewed', {
      circle_id: 'circle-123',
      view: 'week',
    });
  });
});

describe('initAnalytics — privacy super properties', () => {
  it('registers $ip: null alongside platform/app_env so no IP or GeoIP is captured', async () => {
    const { initAnalytics } = await loadWithKey('phc_test_key');
    initAnalytics();
    expect(register).toHaveBeenCalledTimes(1);
    const props = register.mock.calls[0][0] as Record<string, unknown>;
    // `$ip: null` must be PRESENT and null — `undefined` or a missing key would
    // let PostHog fall back to the request IP (and GeoIP-enrich from it).
    expect(props).toHaveProperty('$ip', null);
    expect(props.platform).toBe('web');
    expect(props.app_env).toMatch(/^(development|production)$/);
  });

  it('does not init or register when VITE_POSTHOG_KEY is unset', async () => {
    const { initAnalytics } = await loadWithKey(undefined);
    initAnalytics();
    expect(init).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});

describe('sanitizeErrorText', () => {
  it('leaves stable backend error codes untouched', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    expect(sanitizeErrorText('SUBSCRIPTION_REQUIRED')).toBe('SUBSCRIPTION_REQUIRED');
    expect(sanitizeErrorText('Invalid login credentials')).toBe('Invalid login credentials');
  });

  it('redacts email addresses', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    expect(sanitizeErrorText('Signup failed for pat.doe+care@example.co.uk')).toBe(
      'Signup failed for [email]'
    );
  });

  it('redacts JWT-shaped tokens', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    const out = sanitizeErrorText(`Auth error: ${jwt} rejected`);
    expect(out).toBe('Auth error: [token] rejected');
    expect(out).not.toContain('eyJ');
  });

  it('redacts long opaque tokens but keeps UUID-length ids', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    const apiKey = 'sbp_0123456789abcdef0123456789abcdef01234567';
    expect(sanitizeErrorText(`bad key ${apiKey}`)).toBe('bad key [token]');
    // circle/event ids are already sent as event props — they must survive.
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    expect(sanitizeErrorText(`circle ${uuid} missing`)).toBe(`circle ${uuid} missing`);
  });

  it('strips query strings and fragments from URL-looking substrings', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    const out = sanitizeErrorText(
      'Failed to fetch https://my.circlecare.app/auth/callback?code=abc123&email=pat@example.com'
    );
    expect(out).toBe('Failed to fetch https://my.circlecare.app/auth/callback');
    expect(out).not.toContain('pat@example.com');
    expect(out).not.toContain('code=');
  });

  it('strips query strings from absolute paths but not from prose containing a slash', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    expect(sanitizeErrorText('404 on /invite/ABC123?email=pat@example.com')).toBe(
      '404 on /invite/ABC123'
    );
    expect(sanitizeErrorText('retry and/or contact support?')).toBe(
      'retry and/or contact support?'
    );
  });

  it('collapses whitespace and trims', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    expect(sanitizeErrorText('  network \n\n  timeout \t after 30s  ')).toBe(
      'network timeout after 30s'
    );
  });

  it('truncates to 200 characters', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    const long = Array.from({ length: 80 }, (_, i) => `err${i}`).join(' ');
    expect(long.length).toBeGreaterThan(200);
    const out = sanitizeErrorText(long);
    expect(out).toHaveLength(200);
    expect(out.startsWith('err0 err1 err2')).toBe(true);
  });

  it('is null/undefined-safe and never throws on odd input', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    const odd = [undefined, null, 123, {}, [], true, NaN] as unknown as string[];
    for (const value of odd) {
      expect(() => sanitizeErrorText(value)).not.toThrow();
      expect(sanitizeErrorText(value)).toBe('');
    }
    expect(sanitizeErrorText('')).toBe('');
  });
});

describe('failure helpers sanitize their free-text error property', () => {
  it('signup_failed / login_failed capture the SANITIZED string', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.signupFailed('email', 'duplicate for pat@example.com');
    expect(capture).toHaveBeenCalledWith('signup_failed', {
      method: 'email',
      error: 'duplicate for [email]',
    });

    capture.mockClear();
    Analytics.loginFailed('google', 'callback https://my.circlecare.app/cb?access_token=xyz');
    expect(capture).toHaveBeenCalledWith('login_failed', {
      method: 'google',
      error: 'callback https://my.circlecare.app/cb',
    });
  });

  it('circle_creation_failed / invite_failed also sanitize', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.circleCreationFailed('  BAD_REQUEST \n for pat@example.com ');
    expect(capture).toHaveBeenCalledWith('circle_creation_failed', {
      error: 'BAD_REQUEST for [email]',
    });

    capture.mockClear();
    Analytics.inviteFailed('circle-123', 'already invited pat@example.com');
    expect(capture).toHaveBeenCalledWith('invite_failed', {
      circle_id: 'circle-123',
      error: 'already invited [email]',
    });
  });
});

describe('captureException', () => {
  it('no-ops when VITE_POSTHOG_KEY is unset', async () => {
    const { captureException } = await loadWithKey(undefined);
    captureException(new Error('boom'), 'app');
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  it('forwards the ORIGINAL error object when the message needs no redaction', async () => {
    const { captureException } = await loadWithKey('phc_test_key');
    const error = new Error('Cannot read properties of undefined');
    captureException(error, 'app');
    expect(captureExceptionSpy).toHaveBeenCalledWith(error, {
      boundary: 'app',
      platform: 'web',
    });
  });

  it('sanitizes the message (and the stack header) without mutating the original', async () => {
    const { captureException } = await loadWithKey('phc_test_key');
    const error = new TypeError('Failed to fetch /api/invites?email=pat@example.com');
    captureException(error, 'route');

    const [sent, props] = captureExceptionSpy.mock.calls[0] as [Error, Record<string, unknown>];
    expect(props).toEqual({ boundary: 'route', platform: 'web' });
    expect(sent).not.toBe(error);
    expect(sent.message).toBe('Failed to fetch /api/invites');
    // Name is preserved so the admin digest can still identify the error.
    expect(sent.name).toBe('TypeError');
    expect(sent.stack).toBeDefined();
    expect(sent.stack).not.toContain('pat@example.com');
    // The caller's error is untouched (ErrorBoundary still logs it in DEV).
    expect(error.message).toBe('Failed to fetch /api/invites?email=pat@example.com');
  });

  it('never throws on an exotic error-like value', async () => {
    const { captureException } = await loadWithKey('phc_test_key');
    const weird = { name: 'Weird' } as unknown as Error;
    expect(() => captureException(weird, 'app')).not.toThrow();
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
  });
});

describe('identify / reset (active path)', () => {
  it('identifyUser without an email calls posthog.identify with ONLY the user id', async () => {
    const { identifyUser } = await loadWithKey('phc_test_key');
    identifyUser('user-42');
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith('user-42');
  });

  it('identifyUser with an email attaches email as the ONLY person property', async () => {
    const { identifyUser } = await loadWithKey('phc_test_key');
    identifyUser('user-42', 'pat@example.com');
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith('user-42', { email: 'pat@example.com' });
  });

  it('resetAnalytics calls posthog.reset', async () => {
    const { resetAnalytics } = await loadWithKey('phc_test_key');
    resetAnalytics();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
