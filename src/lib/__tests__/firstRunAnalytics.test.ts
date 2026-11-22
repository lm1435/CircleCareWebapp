import { redactCaptureEvent } from '@/lib/posthog';

// First run v2 (1.4.3): every new event is enums / booleans only, and `circle_id` rides ONLY on the
// identified pipeline. A person who DECLINED analytics goes through the anonymous pipeline
// (lib/posthog.ts `redactCaptureEvent(event, true)` -> stripIdentifiersForAnonymous + UUID mask),
// which these events must not bypass.

const capture = vi.fn();
vi.mock('@/lib/env', () => ({ env: { VITE_POSTHOG_KEY: 'phc_test' } }));
vi.mock('@/lib/analyticsMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analyticsMode')>();
  return { ...actual, analyticsCollectionAllowed: () => true };
});
vi.mock('@/lib/posthogLoader', () => ({
  withPosthog: (fn: (p: { capture: typeof capture }) => void) => fn({ capture }),
}));

const CIRCLE = '3f2b8c1e-9a4d-4e57-8b21-6c0d5e7f9a10';

async function fireAll(): Promise<Array<[string, Record<string, unknown>]>> {
  const { Analytics } = await import('@/lib/analytics');
  capture.mockClear();
  Analytics.firstRunRecipientViewed('web');
  Analytics.firstRunRecipientSubmitted(false);
  Analytics.circleAutoCreated({ circleId: CIRCLE, isSelfCare: false, success: true, retried: false });
  Analytics.firstRunCircleMoment({ circleId: CIRCLE, skipped: false, durationBucket: 'fast' });
  Analytics.firstRunTypeSwitched('medication', 'appointment', CIRCLE);
  Analytics.firstRunMedicationSaved({
    circleId: CIRCLE,
    preset: 'morning',
    recurrence: 'daily',
    dosageFilled: true,
    doseCount: 1,
    firstItemType: 'medication',
    // owner 2026-11-21: no preselected time on a new medication, so a medication never keeps a default.
    timeDefaultKept: false,
    hasTime: true,
  });
  Analytics.firstRunAllSetViewed({ circleId: CIRCLE, path: 'owner', remindersOn: false, firstItemType: 'medication' });
  Analytics.firstRunInviteAction({ circleId: CIRCLE, method: 'share_link', completed: true });
  Analytics.otpAutoSubmitted(true);
  Analytics.firstRunStepViewed(CIRCLE, 'all_set', 'email');
  Analytics.firstRunStepCompleted('first_item', 'under_10s', 'email', CIRCLE);
  Analytics.firstRunBackTapped('account');
  Analytics.firstRunAbandoned('code');
  Analytics.firstRunStepFailed('join', 'invite_invalid', 'invited');
  Analytics.firstRunStepSkipped('first_item', 'google');
  return capture.mock.calls as Array<[string, Record<string, unknown>]>;
}

describe('first run v2 analytics', () => {
  it('POSITIVE: every event fires with its enum properties', async () => {
    const calls = await fireAll();
    const names = calls.map(([n]) => n);
    expect(names).toEqual([
      'first_run_recipient_viewed',
      'first_run_recipient_submitted',
      'circle_auto_created',
      'first_run_circle_moment',
      'first_run_type_switched',
      'first_run_medication_saved',
      'first_run_all_set_viewed',
      'first_run_invite_action',
      'otp_auto_submitted',
      'first_run_step_viewed',
      'first_run_step_completed',
      'first_run_back_tapped',
      'first_run_abandoned',
      'first_run_step_failed',
      'first_run_step_skipped',
    ]);
    // owner 2026-11-21: no preselected time on a new medication: the flag is still sent, as false.
    expect(calls[5][1]).toMatchObject({ first_item_type: 'medication', time_default_kept: false, has_time: true });
    expect(calls[5][1]).toHaveProperty('time_default_kept', false);
    expect(calls[9][1]).toMatchObject({ step: 'all_set', path: 'email' });
  });

  it('POSITIVE: an appointment / task that keeps its 9:00 AM default still reports time_default_kept true', async () => {
    const { Analytics } = await import('@/lib/analytics');
    capture.mockClear();
    Analytics.firstRunMedicationSaved({
      circleId: CIRCLE,
      preset: 'other',
      recurrence: 'none',
      dosageFilled: false,
      doseCount: 1,
      firstItemType: 'appointment',
      timeDefaultKept: true,
      hasTime: true,
    });
    expect(capture.mock.calls[0][1]).toMatchObject({ first_item_type: 'appointment', time_default_kept: true });
  });

  it('POSITIVE: consented (identified pipeline) keeps circle_id', async () => {
    const calls = await fireAll();
    const out = redactCaptureEvent({ event: calls[2][0], properties: calls[2][1] }, false);
    expect(out.properties).toMatchObject({ circle_id: CIRCLE });
  });

  it('NEGATIVE: declined (anonymous pipeline) - no event carries an id or a UUID', async () => {
    const calls = await fireAll();
    for (const [event, properties] of calls) {
      const out = redactCaptureEvent({ event, properties }, true);
      const props = out.properties as Record<string, unknown>;
      expect(Object.keys(props).filter((k) => k === 'id' || k.endsWith('_id'))).toEqual([]);
      expect(JSON.stringify(props)).not.toContain(CIRCLE);
    }
  });

  it('NEGATIVE: no first-run event carries free text (only booleans, numbers and short enums)', async () => {
    const calls = await fireAll();
    for (const [, properties] of calls) {
      for (const [key, value] of Object.entries(properties ?? {})) {
        if (key === 'circle_id') continue;
        if (typeof value === 'string') expect(value).toMatch(/^[a-z0-9_]{1,24}$/);
        else expect(['boolean', 'number']).toContain(typeof value);
      }
    }
  });
});

// first_run_step_failed (owner 2026-11-22): same pipeline as every other first_run_* event.
describe('first_run_step_failed', () => {
  it('POSITIVE: exactly step, reason and path (no circle_id, no message)', async () => {
    const { Analytics } = await import('@/lib/analytics');
    capture.mockClear();
    Analytics.firstRunStepFailed('code', 'invalid_code', 'email');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0]).toEqual([
      'first_run_step_failed',
      { step: 'code', reason: 'invalid_code', path: 'email' },
    ]);
  });

  it('POSITIVE: identified (consented) and anonymous (declined) pipelines both keep the enums', async () => {
    const { Analytics } = await import('@/lib/analytics');
    capture.mockClear();
    Analytics.firstRunStepFailed('first_item', 'validation', 'google');
    const [event, properties] = capture.mock.calls[0] as [string, Record<string, unknown>];
    for (const anonymous of [false, true]) {
      const out = redactCaptureEvent({ event, properties }, anonymous);
      expect(out.properties).toEqual({ step: 'first_item', reason: 'validation', path: 'google' });
    }
  });

  it('NEGATIVE: off-enum values (a message, an address) are coerced, never sent', async () => {
    const { Analytics } = await import('@/lib/analytics');
    capture.mockClear();
    Analytics.firstRunStepFailed(
      'maria@example.com' as never,
      'Invalid email or password' as never,
      'Lisinopril' as never
    );
    expect(capture.mock.calls[0][1]).toEqual({ step: 'welcome', reason: 'unknown', path: 'email' });
  });
});

describe('first_run_step_failed consent gate', () => {
  it('NEGATIVE: nothing is sent when collection is not allowed (the same emit gate as every event)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/analyticsMode', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/analyticsMode')>();
      return { ...actual, analyticsCollectionAllowed: () => false };
    });
    const { Analytics } = await import('@/lib/analytics');
    capture.mockClear();
    Analytics.firstRunStepFailed('account', 'network', 'email');
    Analytics.firstRunStepViewed(undefined, 'account', 'email');
    expect(capture).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/analyticsMode');
    vi.resetModules();
  });
});

describe('first_run_step_skipped', () => {
  it('POSITIVE: exactly step and path; both pipelines keep them', async () => {
    const { Analytics } = await import('@/lib/analytics');
    capture.mockClear();
    Analytics.firstRunStepSkipped('first_item', 'email');
    const [event, properties] = capture.mock.calls[0] as [string, Record<string, unknown>];
    expect(event).toBe('first_run_step_skipped');
    for (const anonymous of [false, true]) {
      expect(redactCaptureEvent({ event, properties }, anonymous).properties).toEqual({
        step: 'first_item',
        path: 'email',
      });
    }
  });

  it('NEGATIVE: off-enum values are coerced, never sent', async () => {
    const { Analytics } = await import('@/lib/analytics');
    capture.mockClear();
    Analytics.firstRunStepSkipped('Metformin' as never, 'rosa@example.com' as never);
    expect(capture.mock.calls[0][1]).toEqual({ step: 'welcome', path: 'email' });
  });
});
