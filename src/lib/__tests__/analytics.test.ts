import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAnalyticsConsent, __resetAnalyticsConsentCache } from '../analyticsConsent';
import { FAILURE_FALLBACK_CODES, classifyFailureCode } from '../apiErrors';

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
const optOut = vi.fn();
const optIn = vi.fn();
const captureExceptionSpy = vi.fn();

vi.mock('posthog-js', () => ({
  default: {
    init,
    register,
    capture,
    identify,
    reset,
    opt_out_capturing: optOut,
    opt_in_capturing: optIn,
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
  // Prime the shared lazy-loader as if posthog-js were already loaded AND
  // configured, so every call below (Analytics.*, initAnalytics,
  // identifyUser, etc.) resolves SYNCHRONOUSLY — exactly as it did before
  // lib/posthog.ts / lib/analytics.ts started loading posthog-js lazily. Real
  // queue/lazy-load behavior is covered separately in posthogLoader.test.ts.
  const posthogModule = await import('posthog-js');
  const loader = await import('@/lib/posthogLoader');
  loader.__primePosthogForTests(posthogModule.default);

  const analytics = await import('@/lib/analytics');
  const posthog = await import('@/lib/posthog');
  return {
    Analytics: analytics.Analytics,
    sanitizeErrorText: analytics.sanitizeErrorText,
    ...posthog,
  };
}

type AnalyticsModeModule = typeof import('@/lib/analyticsMode');

/**
 * Force the DECLINED mode to 'off' — what ANONYMOUS_ANALYTICS_WHEN_DECLINED=false
 * resolves to — without editing the constant. The flag is ON in the shipped
 * build (analyticsMode.test.ts pins it), but the 'off' branches in
 * lib/posthog.ts are kept correct so it can be turned back off in one line;
 * these overrides keep those branches under test. Call BEFORE `loadWithKey`
 * and `vi.doUnmock('@/lib/analyticsMode')` in `afterEach`.
 */
function forceDeclinedModeOff(): void {
  vi.doMock('@/lib/analyticsMode', async (importOriginal) => {
    const actual = await importOriginal<AnalyticsModeModule>();
    const resolveAnalyticsMode = (consented: boolean): 'full' | 'off' =>
      consented ? 'full' : 'off';
    // Read consent through the SAME fresh module instance posthog.ts will use.
    const consent = await import('@/lib/analyticsConsent');
    const currentAnalyticsMode = () => resolveAnalyticsMode(consent.getAnalyticsConsent());
    return {
      ...actual,
      ANONYMOUS_ANALYTICS_WHEN_DECLINED: false,
      resolveAnalyticsMode,
      currentAnalyticsMode,
      analyticsCollectionAllowed: () => actual.collectionAllowed(currentAnalyticsMode()),
    };
  });
}

beforeEach(() => {
  capture.mockClear();
  identify.mockClear();
  reset.mockClear();
  init.mockClear();
  register.mockClear();
  captureExceptionSpy.mockClear();
  // `capture` is now gated on CONSENT as well as on the key, so that an opt-out
  // takes effect immediately rather than at the next page load. These cases are
  // about what a captured event CONTAINS, so they need a consenting visitor.
  __resetAnalyticsConsentCache();
  setAnalyticsConsent(true);
});

afterEach(() => {
  vi.doUnmock('@/lib/env');
});

describe('analytics wrapper — optional / no-op path', () => {
  it('does NOT call posthog.capture when VITE_POSTHOG_KEY is unset', async () => {
    const { Analytics } = await loadWithKey(undefined);
    Analytics.circleCreated(true);
    Analytics.medicationConfirmed('c1', 'taken', 'care_profile');
    Analytics.logout();
    Analytics.onboardingStarted();
    Analytics.onboardingFlowCompleted('created');
    expect(capture).not.toHaveBeenCalled();
  });

  it('identifyUser / resetAnalytics no-op when key is unset', async () => {
    const { identifyUser, resetAnalytics } = await loadWithKey(undefined);
    identifyUser('user-1');
    identifyUser('user-1');
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

  it('medication_confirmed carries circle_id + status + source, and no PHI', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.medicationConfirmed('circle-123', 'taken_late', 'care_profile');
    expect(capture).toHaveBeenCalledWith('medication_confirmed', {
      circle_id: 'circle-123',
      status: 'taken_late',
      // Same enum mobile emits, so both platforms land in ONE series and $lib
      // tells them apart. Web used to send no source at all, which parked every
      // web confirm in the same bucket as pre-instrumentation mobile builds.
      source: 'care_profile',
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

  it('vital_updated carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.vitalUpdated('circle-123');
    expect(capture).toHaveBeenCalledWith('vital_updated', { circle_id: 'circle-123' });
  });

  it('vital_deleted carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.vitalDeleted('circle-123');
    expect(capture).toHaveBeenCalledWith('vital_deleted', { circle_id: 'circle-123' });
  });

  it('document_updated carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.documentUpdated('circle-123');
    expect(capture).toHaveBeenCalledWith('document_updated', { circle_id: 'circle-123' });
  });

  it('document_deleted carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.documentDeleted('circle-123');
    expect(capture).toHaveBeenCalledWith('document_deleted', { circle_id: 'circle-123' });
  });

  it('emergency_info_viewed carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.emergencyInfoViewed('circle-123');
    expect(capture).toHaveBeenCalledWith('emergency_info_viewed', { circle_id: 'circle-123' });
  });

  it('emergency_info_updated carries circle_id + fields_updated (field NAMES only)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.emergencyInfoUpdated('circle-123', ['blood_type', 'allergies']);
    expect(capture).toHaveBeenCalledWith('emergency_info_updated', {
      circle_id: 'circle-123',
      fields_updated: ['blood_type', 'allergies'],
    });
  });

  it('circle_updated / circle_deleted carry only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.circleUpdated('circle-123');
    expect(capture).toHaveBeenCalledWith('circle_updated', { circle_id: 'circle-123' });
    capture.mockClear();
    Analytics.circleDeleted('circle-123');
    expect(capture).toHaveBeenCalledWith('circle_deleted', { circle_id: 'circle-123' });
  });

  it('member_removed carries circle_id and NO user id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.memberRemoved('circle-123');
    expect(capture).toHaveBeenCalledWith('member_removed', { circle_id: 'circle-123' });
  });

  it('circle_left carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.circleLeft('circle-123');
    expect(capture).toHaveBeenCalledWith('circle_left', { circle_id: 'circle-123' });
  });

  it('care_note_updated carries circle_id + category_count (never mood/body)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.careNoteUpdated('circle-123', { categoryCount: 2 });
    expect(capture).toHaveBeenCalledWith('care_note_updated', {
      circle_id: 'circle-123',
      category_count: 2,
    });
  });

  it('care_note_deleted carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.careNoteDeleted('circle-123');
    expect(capture).toHaveBeenCalledWith('care_note_deleted', { circle_id: 'circle-123' });
  });

  it('activity_feed_viewed carries only circle_id', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.activityFeedViewed('circle-123');
    expect(capture).toHaveBeenCalledWith('activity_feed_viewed', { circle_id: 'circle-123' });
  });

  it('language_changed / timezone_changed carry the raw setting value', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.languageChanged('es');
    expect(capture).toHaveBeenCalledWith('language_changed', { language: 'es' });
    capture.mockClear();
    Analytics.timezoneChanged('America/Denver');
    expect(capture).toHaveBeenCalledWith('timezone_changed', { timezone: 'America/Denver' });
  });

  it('account_deleted carries no properties', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.accountDeleted();
    expect(capture).toHaveBeenCalledWith('account_deleted', undefined);
  });

  it('password reset / OTP recovery events carry no properties', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.passwordResetRequested();
    expect(capture).toHaveBeenCalledWith('password_reset_requested', undefined);
    capture.mockClear();
    Analytics.passwordResetCompleted();
    expect(capture).toHaveBeenCalledWith('password_reset_completed', undefined);
    capture.mockClear();
    Analytics.passwordResetFailed();
    expect(capture).toHaveBeenCalledWith('password_reset_failed', undefined);
    capture.mockClear();
    Analytics.otpVerified();
    expect(capture).toHaveBeenCalledWith('otp_verified', undefined);
    capture.mockClear();
    Analytics.otpFailed();
    expect(capture).toHaveBeenCalledWith('otp_failed', undefined);
    capture.mockClear();
    Analytics.otpResent();
    expect(capture).toHaveBeenCalledWith('otp_resent', undefined);
  });

  it('help_item_expanded carries the stable item key, never the question/answer text', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.helpItemExpanded('gettingStarted.0');
    expect(capture).toHaveBeenCalledWith('help_item_expanded', {
      item_key: 'gettingStarted.0',
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

/**
 * PAYWALL EVENTS — the exact names and properties mobile sends.
 *
 * These are literal-string assertions on purpose. `paywall_context` is the
 * property the whole onboarding-paywall ABA is computed from (1.1.3–1.1.5 no
 * paywall: 34 signups → 1 conversion; 1.1.6–1.1.10 with it: 113 → 25), and a
 * value that does not match mobile's spelling does not fall into the wrong
 * cohort — it silently invents a third one and every rate is wrong by an
 * unknown amount. Comparing against a constant imported from the source would
 * make a rename invisible here, which is precisely the failure to prevent.
 */
describe('PDF export events mirror mobile exactly (plan pdf-export-parity, decision 10)', () => {
  it('adherence_report_exported carries circle_id + period enum', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.adherenceReportExported('circle-123', '30d');
    expect(capture).toHaveBeenCalledWith('adherence_report_exported', {
      circle_id: 'circle-123',
      period: '30d',
    });
  });

  it('care_summary_shared carries circle_id + format', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.careSummaryShared('circle-123', 'pdf');
    expect(capture).toHaveBeenCalledWith('care_summary_shared', {
      circle_id: 'circle-123',
      format: 'pdf',
    });
  });

  it('care_summary_export_failed / adherence_report_export_failed carry stage + code ONLY (no circle_id, no message)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.careSummaryExportFailed({ stage: 'print', code: 'PRINT_FAILED' });
    expect(capture).toHaveBeenCalledWith('care_summary_export_failed', {
      stage: 'print',
      code: 'PRINT_FAILED',
    });
    Analytics.adherenceReportExportFailed({ stage: 'timeout', code: 'PRINT_TIMEOUT' });
    expect(capture).toHaveBeenCalledWith('adherence_report_export_failed', {
      stage: 'timeout',
      code: 'PRINT_TIMEOUT',
    });
    for (const call of capture.mock.calls) {
      expect(Object.keys(call[1] as Record<string, unknown>).sort()).toEqual(['code', 'stage']);
    }
  });

  it('sends no export event at all when PostHog is unconfigured', async () => {
    const { Analytics } = await loadWithKey(undefined);
    Analytics.adherenceReportExported('circle-123', '7d');
    Analytics.careSummaryShared('circle-123', 'pdf');
    Analytics.careSummaryExportFailed({ stage: 'print', code: 'PRINT_FAILED' });
    Analytics.adherenceReportExportFailed({ stage: 'print', code: 'PRINT_FAILED' });
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('paywall events mirror mobile exactly', () => {
  it('plan_selection_viewed carries paywall_context', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.planSelectionViewed('onboarding');
    expect(capture).toHaveBeenCalledWith('plan_selection_viewed', {
      paywall_context: 'onboarding',
    });
  });

  it('plan_selection_free_selected carries paywall_context', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.planSelectionFreeSelected('onboarding');
    expect(capture).toHaveBeenCalledWith('plan_selection_free_selected', {
      paywall_context: 'onboarding',
    });
  });

  it('plan_selection_subscribed carries plan + paywall_context', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.planSelectionSubscribed('annual', 'capacity');
    expect(capture).toHaveBeenCalledWith('plan_selection_subscribed', {
      plan: 'annual',
      paywall_context: 'capacity',
    });
  });

  it('plan_selection_trial_started carries plan + paywall_context', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.planSelectionTrialStarted('monthly', 'feature');
    expect(capture).toHaveBeenCalledWith('plan_selection_trial_started', {
      plan: 'monthly',
      paywall_context: 'feature',
    });
  });

  it('plan_selection_purchase_cancelled carries plan + paywall_context', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.planSelectionPurchaseCancelled('annual', 'onboarding');
    expect(capture).toHaveBeenCalledWith('plan_selection_purchase_cancelled', {
      plan: 'annual',
      paywall_context: 'onboarding',
    });
  });

  it('paywall_dismissed carries BOTH trigger (mobile\'s shipped name) and paywall_context', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.paywallDismissed('onboarding');
    // Mobile's `paywallDismissed(trigger)` is called with the context
    // (PlanSelectionScreen.tsx:446), so the shipped mobile property is
    // `trigger`. Dropping either key breaks one half of the analysis: without
    // `trigger` this event stops matching mobile's history, without
    // `paywall_context` it is the one paywall event that cannot be broken down
    // alongside the other four.
    expect(capture).toHaveBeenCalledWith('paywall_dismissed', {
      trigger: 'onboarding',
      paywall_context: 'onboarding',
    });
  });

  it('defaults an omitted context to general, exactly as mobile does', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.planSelectionViewed();
    Analytics.paywallDismissed();
    expect(capture).toHaveBeenCalledWith('plan_selection_viewed', {
      paywall_context: 'general',
    });
    expect(capture).toHaveBeenCalledWith('paywall_dismissed', {
      trigger: 'general',
      paywall_context: 'general',
    });
  });

  it('sends no paywall event at all when PostHog is unconfigured', async () => {
    const { Analytics } = await loadWithKey(undefined);
    Analytics.planSelectionViewed('onboarding');
    Analytics.planSelectionSubscribed('annual', 'onboarding');
    Analytics.paywallDismissed('onboarding');
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('initAnalytics — privacy super properties', () => {
  it('registers $ip: null alongside platform/app_env so no IP or GeoIP is captured', async () => {
    // initAnalytics is now consent-gated: a key alone no longer starts it.
    setAnalyticsConsent(true);
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

/**
 * THE FAILURE VOCABULARY MUST SURVIVE THIS SANITIZER UNCHANGED.
 *
 * `sanitizeErrorText` is NOT the same function on mobile and web:
 *   mobile (services/analytics.ts) redacts runs of 20+ chars containing BOTH
 *                                  a letter and a digit
 *   web    (lib/analytics.ts)      redacts runs of 40+ chars, ANY composition
 *          (MAX_ERROR_TEXT_LENGTH / OPAQUE_TOKEN_RE above, ~line 53-66)
 *
 * That is a deliberate, documented divergence (mobile pins the invariant in
 * `__tests__/utils/failureCodeIsBounded.test.ts`, describes 7 and 9) — the
 * handoff says nothing `classifyFailureCode` can emit today crosses either
 * threshold, so the digest never splits one failure into two rows. This is
 * the web-side half of that same invariant: every code `circle_creation_failed`
 * (and any other failure event) can actually emit must pass through THIS
 * sanitizer byte-for-byte.
 */
describe('sanitizeErrorText leaves the failure-code vocabulary intact', () => {
  it.each([
    ...FAILURE_FALLBACK_CODES,
    'http_502',
    'http_100',
    'http_599',
    'SUBSCRIPTION_REQUIRED',
    'VALIDATION_ERROR',
    'SERVER_ERROR',
    'CARE_RECIPIENT_INVITE_PENDING',
    'CHUNK_PAGING_UNTERMINATED',
    'CIRCLE_ARCHIVED',
  ])('%s passes through unchanged', async (value) => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    expect(sanitizeErrorText(value)).toBe(value);
  });

  it('classifyFailureCode outputs for representative rejection shapes all survive unchanged', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    const cases: Array<[unknown, string]> = [
      [{ success: false, error: { code: 'SUBSCRIPTION_REQUIRED' } }, 'SUBSCRIPTION_REQUIRED'],
      [{ response: { status: 502 } }, 'http_502'],
      [new Error('timeout of 30000ms exceeded'), 'timeout'],
      [new Error('Network Error'), 'network_error'],
      [{ success: false, error: {} }, 'api_error_no_code'],
      ['<html><title>502 Bad Gateway</title></html>', 'non_json_response'],
      [new Error('AsyncStorage write failed'), 'client_error'],
      [Object.create(null), 'unknown_error'],
    ];
    for (const [input, expected] of cases) {
      const code = classifyFailureCode(input);
      expect(code).toBe(expected);
      expect(sanitizeErrorText(code)).toBe(code);
    }
  });

  it('documents the two thresholds this invariant depends on (20+letter+digit vs 40+ any)', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test_key');
    // Below web's 40-char threshold: untouched here (mobile would redact this
    // one — 24 chars, contains a digit — which is the documented divergence
    // band; nothing CURRENTLY emitted lands there, which is exactly what the
    // it.each above pins).
    const divergent = 'SOME_CODE_V2_WITH_DIGITS';
    expect(divergent).toHaveLength(24);
    expect(sanitizeErrorText(divergent)).toBe(divergent);
    // At/over web's 40-char threshold: web redacts regardless of composition.
    const overWebThreshold = 'A'.repeat(40);
    expect(sanitizeErrorText(overWebThreshold)).toBe('[token]');
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

describe('error_occurred (mobile parity: Analytics.errorOccurred)', () => {
  it('uses the SAME event name and shape as mobile: screen, sanitized error, spread context', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.errorOccurred('medication_confirm', 'medication_confirm_error', {
      circle_id: 'circle-123',
      status: 'taken',
      source: 'care_profile',
      code: 'MEDICATION_DISCONTINUED',
    });
    expect(capture).toHaveBeenCalledWith('error_occurred', {
      screen: 'medication_confirm',
      error: 'medication_confirm_error',
      circle_id: 'circle-123',
      status: 'taken',
      source: 'care_profile',
      code: 'MEDICATION_DISCONTINUED',
    });
  });

  it('sanitizes an email and a JWT out of `error` (callers should still pass constants)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.errorOccurred(
      'profile',
      'save failed for pat@example.com with eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'
    );
    expect(capture).toHaveBeenCalledWith('error_occurred', {
      screen: 'profile',
      error: 'save failed for [email] with [token]',
    });
    const props = capture.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(String(props.error)).not.toMatch(/@|eyJ/);
  });

  it('context is optional', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.errorOccurred('documents', 'documents_mutation_error');
    expect(capture).toHaveBeenCalledWith('error_occurred', {
      screen: 'documents',
      error: 'documents_mutation_error',
    });
  });

  it('no-ops when VITE_POSTHOG_KEY is unset', async () => {
    const { Analytics } = await loadWithKey(undefined);
    Analytics.errorOccurred('profile', 'profile_mutation_error', { code: 'timeout' });
    expect(capture).not.toHaveBeenCalled();
  });
});

describe('captureException', () => {
  it('no-ops when VITE_POSTHOG_KEY is unset', async () => {
    const { captureException } = await loadWithKey(undefined);
    captureException(new Error('boom'), 'app');
    expect(captureExceptionSpy).not.toHaveBeenCalled();
  });

  it('merges `extra` crash-record fields but never lets them override boundary/platform', async () => {
    const { captureException } = await loadWithKey('phc_test_key');
    const error = new Error('render crash');
    captureException(error, 'root', {
      fatal: true,
      component_stack: 'at Thrower at Wrap1',
      boundary: 'spoofed',
      platform: 'ios',
    });
    expect(captureExceptionSpy).toHaveBeenCalledWith(error, {
      fatal: true,
      component_stack: 'at Thrower at Wrap1',
      boundary: 'root',
      platform: 'web',
    });
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

  it('drops an email a caller still passes — NO person property ever reaches PostHog', async () => {
    // Founder decision 2026-09-10: web matches mobile and identifies by opaque
    // id only. Called through a loose reference on purpose, so the removed
    // parameter is EXERCISED at runtime rather than merely rejected by tsc —
    // an `any`, a JS import or a future edit must not be able to reopen it.
    const { identifyUser } = await loadWithKey('phc_test_key');
    const loose = identifyUser as unknown as (id: string, email?: string) => void;
    loose('user-42', 'pat@example.com');
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify.mock.calls).toEqual([['user-42']]);
    expect(JSON.stringify(identify.mock.calls)).not.toContain('pat@example.com');
  });

  it('resetAnalytics calls posthog.reset', async () => {
    const { resetAnalytics } = await loadWithKey('phc_test_key');
    resetAnalytics();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

/**
 * The gate itself. The web companion emits to the same PostHog project as
 * mobile and used to initialise on nothing but the presence of an API key —
 * while the marketing site has required an explicit "accepted" since launch.
 */
describe('initAnalytics — consent gate', () => {
  beforeEach(() => {
    // Scoped to this describe: the posthog-js doubles are module-level, so
    // without a reset an assertion here can pass on a call made by the
    // previous test rather than by the code under test.
    vi.clearAllMocks();
    localStorage.clear();
    __resetAnalyticsConsentCache();
  });

  it('initialises an ANONYMOUS client without consent (flag on): init, no opt-in, no identify', async () => {
    // Declined resolves to 'anonymous' while ANONYMOUS_ANALYTICS_WHEN_DECLINED
    // is on (decision 2026-09-07): the client is constructed so the declined
    // cohort's failures stay visible, but it is never opted in (nothing to
    // un-remember under memory persistence) and identify is refused.
    const { initAnalytics, identifyUser } = await loadWithKey('phc_test_key');
    initAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
    expect(optIn).not.toHaveBeenCalled();
    identifyUser('user-1');
    expect(identify).not.toHaveBeenCalled();
  });

  it('constructs NOTHING without consent while the flag is off', async () => {
    forceDeclinedModeOff();
    try {
      const { initAnalytics } = await loadWithKey('phc_test_key');
      initAnalytics();
      expect(init).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/lib/analyticsMode');
    }
  });

  it('initialises once consent is given', async () => {
    setAnalyticsConsent(true);
    const { initAnalytics } = await loadWithKey('phc_test_key');
    initAnalytics();
    expect(init).toHaveBeenCalledTimes(1);
  });

  /**
   * The privacy policy states "We do not use session recording in the apps".
   * Without `disable_session_recording: true`, that claim was only true
   * because the PostHog PROJECT setting has recording off — a setting anyone
   * with dashboard access could flip with no code change on our side. This
   * makes the promise code-enforced instead of config-enforced.
   */
  it('disables session recording at the SDK, not just via masked inputs', async () => {
    setAnalyticsConsent(true);
    const { initAnalytics } = await loadWithKey('phc_test_key');
    initAnalytics();

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][1] as Record<string, unknown>;
    expect(options.disable_session_recording).toBe(true);
    // Belt-and-braces: still masked if recording is ever re-enabled.
    expect(options.session_recording).toEqual({ maskAllInputs: true });
  });

  /**
   * `opt_out_capturing()` is REMEMBERED by posthog-js. A visitor who turned
   * analytics off and later back on would otherwise get a toggle reading "on"
   * over a client that captures nothing — the worst kind of broken, because
   * the user and the data both think everything is fine.
   */
  it('opts back IN on init, so re-enabling actually re-enables', async () => {
    setAnalyticsConsent(true);
    const { initAnalytics } = await loadWithKey('phc_test_key');
    initAnalytics();
    expect(optIn).toHaveBeenCalled();
  });

  it('does not opt in when there is no consent', async () => {
    const { initAnalytics } = await loadWithKey('phc_test_key');
    initAnalytics();
    expect(optIn).not.toHaveBeenCalled();
  });

  /**
   * Withdrawing lands the visitor in the DECLINED mode — 'anonymous' with the
   * flag on. reset drops the queue and the distinct id so the batch built up
   * under the known identity is never transmitted; opting out would silence
   * the anonymous client until the next page load — the exact cohort the flag
   * exists to keep visible — so it must NOT happen.
   */
  it('resets but does NOT opt out when consent is withdrawn (anonymous fallback)', async () => {
    setAnalyticsConsent(true);
    const { disableAnalytics } = await loadWithKey('phc_test_key');
    disableAnalytics();
    expect(reset).toHaveBeenCalledTimes(1);
    expect(optOut).not.toHaveBeenCalled();
  });
});

describe('withdrawing consent drops the identity, not the collection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetAnalyticsConsentCache();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/analyticsMode');
  });

  /**
   * The 'off' branch (flag off). posthog-js's `reset()` calls
   * `consent.reset()`, which DELETES the `__ph_opt_in_out_<token>` key. Opting
   * out and THEN resetting therefore throws the opt-out away and leaves the
   * SDK opted back in — so the order here is the fix, not a style choice.
   */
  it('OFF mode: resets BEFORE opting out, so the opt-out is what survives', async () => {
    forceDeclinedModeOff();
    const { disableAnalytics } = await loadWithKey('phc_test');
    disableAnalytics();

    expect(reset).toHaveBeenCalled();
    expect(optOut).toHaveBeenCalled();
    const resetOrder = reset.mock.invocationCallOrder[0];
    const optOutOrder = optOut.mock.invocationCallOrder[0];
    expect(
      resetOrder,
      'reset() must run first — it clears the opt-out key posthog-js stores'
    ).toBeLessThan(optOutOrder);
  });

  /**
   * The Profile toggle tears down FIRST (`disableAnalytics`) and persists the
   * new consent SECOND — mirrored here. In anonymous mode the client keeps
   * capturing after both steps, under the fresh id `reset` produced.
   */
  it('keeps capturing after withdrawal — anonymously, not silently', async () => {
    const { Analytics, disableAnalytics } = await loadWithKey('phc_test');
    // `loadWithKey` calls vi.resetModules(), so the consent module the freshly
    // imported analytics sees is a DIFFERENT instance (with its own cache) than
    // the one imported at the top of this file. Drive the one it actually uses.
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    Analytics.circleCreated(true);
    expect(capture).toHaveBeenCalledTimes(1);

    capture.mockClear();
    disableAnalytics();
    consent.setAnalyticsConsent(false);
    Analytics.circleCreated(true);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(optOut).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('OFF mode: suppresses captures immediately after withdrawal, without a reload', async () => {
    forceDeclinedModeOff();
    const { Analytics, disableAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    Analytics.circleCreated(true);
    expect(capture).toHaveBeenCalledTimes(1);

    capture.mockClear();
    disableAnalytics();
    consent.setAnalyticsConsent(false);
    Analytics.circleCreated(true);
    expect(optOut).toHaveBeenCalledTimes(1);
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses identify after withdrawal and re-attaches it on re-consent', async () => {
    const { identifyUser, disableAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    identifyUser('user-1');
    expect(identify).toHaveBeenCalledTimes(1);

    identify.mockClear();
    disableAnalytics();
    consent.setAnalyticsConsent(false);
    identifyUser('user-1'); // e.g. a re-bootstrap
    expect(identify).not.toHaveBeenCalled();

    consent.setAnalyticsConsent(true); // the toggle back ON, then ProfilePage re-identifies
    identifyUser('user-1');
    expect(identify).toHaveBeenCalledTimes(1);
  });
});

describe('anonymous mode strips stable identifiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetAnalyticsConsentCache();
  });

  type BeforeSend = (e: { event: string; properties: Record<string, unknown> }) => {
    properties: Record<string, unknown>;
  } | null;

  /** The `before_send` posthog.init was configured with. */
  function installedBeforeSend(): BeforeSend {
    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0][1] as { before_send: BeforeSend };
    expect(typeof options.before_send).toBe('function');
    return options.before_send;
  }

  const SAMPLE = {
    circle_id: 'c-1',
    event_id: 'e-1',
    $device_id: 'random-device',
    destination: 'calendar',
    count: 3,
    // Redaction must still run first, in every mode.
    $current_url: 'https://my.circlecare.app/invite/ABC123',
  };

  const CIRCLE = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
  const OTHER = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';
  /** Mirrors what posthog-js attaches from `location.href` + a crash on a circle page. */
  const URL_SAMPLE = {
    $current_url: `https://my.circlecare.app/circles/${CIRCLE}/calendar`,
    $pathname: `/circles/${CIRCLE}/calendar`,
    $referrer: `https://my.circlecare.app/circles/${CIRCLE}`,
    $exception_list: [
      {
        type: 'Error',
        value: `Failed to fetch https://api.circlecare.app/circles/${CIRCLE}/events`,
        stacktrace: { frames: [{ filename: `https://my.circlecare.app/circles/${CIRCLE}/x.js`, lineno: 12 }] },
      },
    ],
    distinct_id: OTHER,
    $session_id: OTHER,
    count: 3,
    recurring: true,
  };

  it('stripIdentifiersForAnonymous drops *_id / id keys, keeps $-keys, distinct_id and everything else', async () => {
    const { stripIdentifiersForAnonymous } = await loadWithKey('phc_test');
    expect(
      stripIdentifiersForAnonymous({
        circle_id: 'c-1',
        event_id: 'e-1',
        id: 'x',
        MEMBER_ID: 'm-1',
        $device_id: 'd',
        $session_id: 's',
        distinct_id: 'random-in-ram',
        destination: 'calendar',
        count: 3,
        video: 'not an id suffix',
      })
    ).toEqual({
      $device_id: 'd',
      $session_id: 's',
      distinct_id: 'random-in-ram',
      destination: 'calendar',
      count: 3,
      video: 'not an id suffix',
    });
    expect(stripIdentifiersForAnonymous(undefined)).toBeUndefined();
  });

  it('maskUuidsDeep masks every UUID inside every string, at any depth, leaving other leaves typed', async () => {
    const { maskUuidsDeep } = await loadWithKey('phc_test');
    expect(maskUuidsDeep(`https://my.circlecare.app/circles/${CIRCLE}/calendar`)).toBe(
      'https://my.circlecare.app/circles/[id]/calendar'
    );
    // Global + case-insensitive: two in one string, one of them uppercase.
    expect(maskUuidsDeep(`${CIRCLE} then ${OTHER}`)).toBe('[id] then [id]');
    expect(
      maskUuidsDeep({
        list: [{ value: `boom at /circles/${CIRCLE}` }],
        n: 3,
        b: false,
        nil: null,
      })
    ).toEqual({ list: [{ value: 'boom at /circles/[id]' }], n: 3, b: false, nil: null });
    expect(maskUuidsDeep('no ids here')).toBe('no ids here');
    expect(maskUuidsDeep(undefined)).toBeUndefined();
  });

  it('before_send in ANONYMOUS mode masks circle UUIDs in $current_url / $pathname / $referrer and inside $exception_list', async () => {
    const { initAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(false);
    initAnalytics();

    const out = installedBeforeSend()({ event: '$exception', properties: { ...URL_SAMPLE } });
    expect(out?.properties).toMatchObject({
      $current_url: 'https://my.circlecare.app/circles/[id]/calendar',
      $pathname: '/circles/[id]/calendar',
      $referrer: 'https://my.circlecare.app/circles/[id]',
      count: 3,
      recurring: true,
    });
    const list = out?.properties.$exception_list as Array<{
      value: string;
      stacktrace: { frames: Array<{ filename: string; lineno: number }> };
    }>;
    expect(list[0].value).toBe('Failed to fetch https://api.circlecare.app/circles/[id]/events');
    expect(list[0].stacktrace.frames[0]).toEqual({
      filename: 'https://my.circlecare.app/circles/[id]/x.js',
      lineno: 12,
    });
    expect(JSON.stringify(out?.properties)).not.toContain(CIRCLE);
  });

  it('before_send in ANONYMOUS mode leaves the SDK\'s own UUID-shaped ids intact (distinct_id, $session_id)', async () => {
    // The memory-mode distinct id is a random UUID; masking it to "[id]" would
    // hand ingestion an event with no usable distinct_id at all.
    const { initAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(false);
    initAnalytics();

    const out = installedBeforeSend()({ event: '$exception', properties: { ...URL_SAMPLE } });
    expect(out?.properties.distinct_id).toBe(OTHER);
    expect(out?.properties.$session_id).toBe(OTHER);
  });

  it('before_send in FULL mode leaves the circle UUID in $current_url and $exception_list in place', async () => {
    const { initAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    initAnalytics();

    const out = installedBeforeSend()({ event: '$exception', properties: { ...URL_SAMPLE } });
    expect(out?.properties).toMatchObject({
      $current_url: `https://my.circlecare.app/circles/${CIRCLE}/calendar`,
      $pathname: `/circles/${CIRCLE}/calendar`,
      $referrer: `https://my.circlecare.app/circles/${CIRCLE}`,
      distinct_id: OTHER,
    });
    const list = out?.properties.$exception_list as Array<{ value: string }>;
    expect(list[0].value).toContain(CIRCLE);
  });

  it('before_send in ANONYMOUS mode strips circle_id (and still redacts)', async () => {
    const { initAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(false);
    initAnalytics();

    const out = installedBeforeSend()({ event: 'calendar_viewed', properties: { ...SAMPLE } });
    expect(out).not.toBeNull();
    expect(out?.properties).not.toHaveProperty('circle_id');
    expect(out?.properties).not.toHaveProperty('event_id');
    expect(out?.properties).toMatchObject({
      $device_id: 'random-device',
      destination: 'calendar',
      count: 3,
    });
    expect(String(out?.properties.$current_url)).not.toContain('ABC123');
  });

  it('before_send in FULL mode leaves circle_id in place (byte-identical to before)', async () => {
    const { initAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    initAnalytics();

    const out = installedBeforeSend()({ event: 'calendar_viewed', properties: { ...SAMPLE } });
    expect(out?.properties).toMatchObject({
      circle_id: 'c-1',
      event_id: 'e-1',
      $device_id: 'random-device',
      destination: 'calendar',
      count: 3,
    });
    expect(String(out?.properties.$current_url)).not.toContain('ABC123');
  });

  it('a mid-session withdrawal strips from the NEXT event on, without re-init', async () => {
    const { initAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    initAnalytics();
    const beforeSend = installedBeforeSend();

    expect(beforeSend({ event: 'x', properties: { circle_id: 'c-1' } })?.properties).toHaveProperty(
      'circle_id'
    );
    consent.setAnalyticsConsent(false);
    expect(
      beforeSend({ event: 'x', properties: { circle_id: 'c-1' } })?.properties
    ).not.toHaveProperty('circle_id');
  });
});

describe('IP suppression covers the opt-in event too', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetAnalyticsConsentCache();
  });

  /**
   * `$ip: null` is registered as a SUPER PROPERTY so it applies to every event.
   * That is only true if it is registered before anything can be captured —
   * and `opt_in_capturing()` captures an event of its own. Opting in first sent
   * exactly one IP-bearing, GeoIP-enriched event per consenting boot.
   */
  it('registers $ip: null BEFORE opting in', async () => {
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    const { initAnalytics } = await loadWithKey('phc_test');
    initAnalytics();

    expect(register).toHaveBeenCalledWith(expect.objectContaining({ $ip: null }));
    expect(optIn).toHaveBeenCalled();
    expect(
      register.mock.invocationCallOrder[0],
      '$ip: null must be registered before opt_in_capturing can emit $opt_in'
    ).toBeLessThan(optIn.mock.invocationCallOrder[0]);
  });

  it('suppresses the $opt_in event itself', async () => {
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    const { initAnalytics } = await loadWithKey('phc_test');
    initAnalytics();

    expect(optIn).toHaveBeenCalledWith(expect.objectContaining({ captureEventName: null }));
  });
});

describe('identify requires PERMISSION, not just a key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetAnalyticsConsentCache();
  });

  /**
   * This was gated on VITE_POSTHOG_KEY alone, so signing in transmitted
   * `$identify` carrying the EMAIL for a visitor who had declined analytics —
   * the most identifying thing this client sends, sent to the one group who
   * said no.
   */
  it('does NOT identify a user who declined', async () => {
    const { identifyUser } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(false);

    identifyUser('user-1');
    expect(identify).not.toHaveBeenCalled();
  });

  it('identifies a user who consented', async () => {
    const { identifyUser } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);

    identifyUser('user-1');
    expect(identify.mock.calls).toEqual([['user-1']]);
  });

  it('stops identifying the moment consent is withdrawn mid-session', async () => {
    const { identifyUser } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    identifyUser('user-1');
    expect(identify).toHaveBeenCalledTimes(1);

    identify.mockClear();
    consent.setAnalyticsConsent(false);
    identifyUser('user-1');
    expect(identify).not.toHaveBeenCalled();
  });

  /**
   * Crash data from the declined cohort is the whole point of the anonymous
   * flag (decision 2026-09-07): it goes out under a random memory-only id,
   * never identified. The `identify` assertion is the control that the report
   * did not sneak out with an identity attached.
   */
  it('DOES send crash reports for a visitor who declined — anonymously', async () => {
    const { captureException, identifyUser } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(false);

    identifyUser('user-1');
    captureException(new Error('boom'), 'AppBoundary');
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
    expect(identify).not.toHaveBeenCalled();
  });

  /**
   * The 'off' branch (flag off): nothing at all. `not.toHaveBeenCalled()` on
   * its own is satisfied by a captureException that NEVER works — a wrong
   * early return, a broken import, a renamed export all pass it — so the
   * consenting case right below is its control: the same spy, installed in
   * the `posthog-js` module mock at the top of this file, must fire there.
   */
  it('OFF mode: does not send crash reports for a visitor who declined', async () => {
    forceDeclinedModeOff();
    try {
      const { captureException } = await loadWithKey('phc_test');
      const consent = await import('@/lib/analyticsConsent');
      consent.setAnalyticsConsent(false);

      captureException(new Error('boom'), 'AppBoundary');
      expect(captureExceptionSpy).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock('@/lib/analyticsMode');
    }
  });

  it('DOES send crash reports once consent is granted', async () => {
    const { captureException } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);

    const error = new Error('boom');
    captureException(error, 'AppBoundary');
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
    expect(captureExceptionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' }),
      expect.objectContaining({ boundary: 'AppBoundary', platform: 'web' })
    );
  });

  it('keeps sending crash reports after consent is withdrawn mid-session (anonymous mode)', async () => {
    const { captureException } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);
    captureException(new Error('first'), 'AppBoundary');
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);

    captureExceptionSpy.mockClear();
    consent.setAnalyticsConsent(false);
    captureException(new Error('second'), 'AppBoundary');
    expect(captureExceptionSpy).toHaveBeenCalledTimes(1);
  });
});

describe('logout does not resurrect analytics for someone who opted out', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    __resetAnalyticsConsentCache();
  });

  afterEach(() => {
    vi.doUnmock('@/lib/analyticsMode');
  });

  /**
   * Flag on: a declined visitor's logout is a plain reset — fresh random
   * distinct id, queue dropped — and capture continues anonymously. Opting out
   * here would silence the anonymous client until the next page load.
   */
  it('resets to a fresh anonymous id and does NOT opt out, when consent is withheld', async () => {
    const { resetAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(false);

    resetAnalytics();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(optOut).not.toHaveBeenCalled();
  });

  /**
   * The 'off' branch (flag off). `posthog.reset()` deletes the opt-out key
   * posthog-js persists, so a bare reset on logout silently re-enables
   * collection: opt out -> log out -> next session is opted back IN with the
   * Privacy toggle still reading off. `disableAnalytics` already ordered
   * around this; the LOGOUT path did not.
   */
  it('OFF mode: re-asserts the opt-out after resetting, when consent is withheld', async () => {
    forceDeclinedModeOff();
    const { resetAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(false);

    resetAnalytics();

    expect(reset).toHaveBeenCalled();
    expect(optOut).toHaveBeenCalled();
    expect(
      reset.mock.invocationCallOrder[0],
      'the opt-out must be re-asserted AFTER the reset that cleared it'
    ).toBeLessThan(optOut.mock.invocationCallOrder[0]);
  });

  it('does NOT opt out a consenting user just because they logged out', async () => {
    // The control: logging out is not a privacy decision.
    const { resetAnalytics } = await loadWithKey('phc_test');
    const consent = await import('@/lib/analyticsConsent');
    consent.setAnalyticsConsent(true);

    resetAnalytics();

    expect(reset).toHaveBeenCalled();
    expect(optOut).not.toHaveBeenCalled();
  });
});

describe('auth credentials never reach PostHog', () => {
  /**
   * The vector: posthog-js registers `$initial_person_info` on the FIRST
   * capture, and `router.tsx` renders `<PageviewTracker />` before `<Outlet />`
   * — so on an OAuth return that capture happens while `location.href` is still
   * `/auth/callback#access_token=…`, before AuthCallbackPage scrubs it.
   *
   * `mask_personal_data_properties: true` closes it at the SDK. This redaction
   * is the second layer, for any other string that carries a token.
   */
  it('strips every Supabase auth param by name', async () => {
    const { sanitizeErrorText } = await loadWithKey('phc_test');
    const mod = await import('@/lib/analytics');
    const url =
      'https://app/auth/callback#access_token=eyJhbGciOi.J9.sig&refresh_token=v1.MRq&expires_in=3600';
    const out = mod.redactAuthTokens(url);

    expect(out).not.toContain('eyJhbGciOi');
    expect(out).not.toContain('v1.MRq');
    expect(out).toContain('access_token=[redacted]');
    expect(out).toContain('refresh_token=[redacted]');
    // Non-credential params survive — this is redaction, not truncation.
    expect(out).toContain('expires_in=3600');
    expect(typeof sanitizeErrorText).toBe('function');
  });

  it('strips provider and id tokens too', async () => {
    const mod = await import('@/lib/analytics');
    const out = mod.redactAuthTokens(
      '#provider_token=abc&provider_refresh_token=def&id_token=ghi'
    );
    expect(out).not.toMatch(/abc|def|ghi/);
  });

  it('leaves ordinary strings untouched', async () => {
    const mod = await import('@/lib/analytics');
    expect(mod.redactAuthTokens('/circles/123/calendar')).toBe('/circles/123/calendar');
  });
});
