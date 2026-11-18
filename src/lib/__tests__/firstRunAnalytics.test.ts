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
    timeDefaultKept: true,
    hasTime: true,
  });
  Analytics.firstRunAllSetViewed({ circleId: CIRCLE, path: 'owner', remindersOn: false, firstItemType: 'medication' });
  Analytics.firstRunInviteAction({ circleId: CIRCLE, method: 'share_link', completed: true });
  Analytics.otpAutoSubmitted(true);
  Analytics.firstRunStepViewed(CIRCLE, 'all_set', 'email');
  Analytics.firstRunStepCompleted('first_item', 'under_10s', 'email', CIRCLE);
  Analytics.firstRunBackTapped('account');
  Analytics.firstRunAbandoned('code');
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
    ]);
    expect(calls[5][1]).toMatchObject({ first_item_type: 'medication', time_default_kept: true, has_time: true });
    expect(calls[9][1]).toMatchObject({ step: 'all_set', path: 'email' });
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
