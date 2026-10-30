import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEXT_STEP_SNOOZE_MS,
  dismissShiftsNudge,
  hasDismissedShiftsNudge,
  hasSeenDoseHint,
  isNextStepSnoozed,
  markDoseHintSeen,
  snoozeNextStep,
} from '../todayCoaching';
import { useAuthStore } from '@/store/authStore';

const setUser = (id: string): void =>
  useAuthStore.setState({
    user: { id, email: `${id}@example.com`, first_name: 'X', last_name: 'Y' },
    isAuthenticated: true,
  } as never);

describe('todayCoaching persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    setUser('u1');
  });

  describe('next-step "Not now" = 3 days', () => {
    it('is exactly 3 days', () => {
      expect(NEXT_STEP_SNOOZE_MS).toBe(3 * 24 * 60 * 60 * 1000);
    });

    it('hides the step until the 3 days are up, then offers it again', () => {
      const t0 = Date.parse('2026-10-28T12:00:00Z');
      expect(isNextStepSnoozed('c1', 'first_med', t0)).toBe(false);
      snoozeNextStep('c1', 'first_med', t0);
      expect(isNextStepSnoozed('c1', 'first_med', t0 + 1000)).toBe(true);
      expect(isNextStepSnoozed('c1', 'first_med', t0 + NEXT_STEP_SNOOZE_MS - 1)).toBe(true);
      expect(isNextStepSnoozed('c1', 'first_med', t0 + NEXT_STEP_SNOOZE_MS)).toBe(false);
    });

    it('snoozing one step does not hide another', () => {
      snoozeNextStep('c1', 'first_med');
      expect(isNextStepSnoozed('c1', 'invite')).toBe(false);
    });

    it('is per circle and per signed-in user', () => {
      snoozeNextStep('c1', 'invite');
      expect(isNextStepSnoozed('c2', 'invite')).toBe(false);
      setUser('u2');
      expect(isNextStepSnoozed('c1', 'invite')).toBe(false);
      setUser('u1');
      expect(isNextStepSnoozed('c1', 'invite')).toBe(true);
    });

    it('a snooze stamped in the future (clock change) does not hide the card forever', () => {
      snoozeNextStep('c1', 'invite', Date.now() + 365 * 86_400_000);
      expect(isNextStepSnoozed('c1', 'invite')).toBe(false);
    });

    it('corrupt storage is read as "not snoozed"', () => {
      localStorage.setItem('today_next_step_snoozed:c1:u1', '{not json');
      expect(isNextStepSnoozed('c1', 'invite')).toBe(false);
      localStorage.setItem('today_next_step_snoozed:c1:u1', '"a string"');
      expect(isNextStepSnoozed('c1', 'invite')).toBe(false);
    });
  });

  describe('first-dose hint: once per user, ever', () => {
    it('is unseen, then seen, per user', () => {
      expect(hasSeenDoseHint()).toBe(false);
      markDoseHintSeen();
      expect(hasSeenDoseHint()).toBe(true);
      setUser('u2');
      expect(hasSeenDoseHint()).toBe(false);
    });
  });

  describe('shifts nudge', () => {
    it('is per user and per circle', () => {
      expect(hasDismissedShiftsNudge('c1')).toBe(false);
      dismissShiftsNudge('c1');
      expect(hasDismissedShiftsNudge('c1')).toBe(true);
      expect(hasDismissedShiftsNudge('c2')).toBe(false);
      setUser('u2');
      expect(hasDismissedShiftsNudge('c1')).toBe(false);
    });
  });

  it('survives blocked storage: reads are "not dismissed", writes do not throw', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(hasSeenDoseHint()).toBe(false);
    expect(hasDismissedShiftsNudge('c1')).toBe(false);
    expect(isNextStepSnoozed('c1', 'invite')).toBe(false);
    expect(() => markDoseHintSeen()).not.toThrow();
    expect(() => dismissShiftsNudge('c1')).not.toThrow();
    expect(() => snoozeNextStep('c1', 'invite')).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
