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

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture,
    identify,
    reset,
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
  return { Analytics: analytics.Analytics, ...posthog };
}

beforeEach(() => {
  capture.mockClear();
  identify.mockClear();
  reset.mockClear();
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
    expect(capture).not.toHaveBeenCalled();
  });

  it('identifyUser / resetAnalytics no-op when key is unset', async () => {
    const { identifyUser, resetAnalytics } = await loadWithKey(undefined);
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

  it('ai_chat_message_sent carries ONLY circle_id (never message text)', async () => {
    const { Analytics } = await loadWithKey('phc_test_key');
    Analytics.aiChatMessageSent('circle-123');
    expect(capture).toHaveBeenCalledWith('ai_chat_message_sent', { circle_id: 'circle-123' });
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

describe('identify / reset (active path)', () => {
  it('identifyUser calls posthog.identify with ONLY the user id (no traits)', async () => {
    const { identifyUser } = await loadWithKey('phc_test_key');
    identifyUser('user-42');
    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith('user-42');
  });

  it('resetAnalytics calls posthog.reset', async () => {
    const { resetAnalytics } = await loadWithKey('phc_test_key');
    resetAnalytics();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
