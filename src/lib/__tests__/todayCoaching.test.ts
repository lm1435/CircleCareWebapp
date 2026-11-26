import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEXT_STEP_SNOOZE_MS,
  applicableNextSteps,
  dismissHelperCard,
  hasDismissedHelperCard,
  helperCardAction,
  helperCardBody,
  nextStepViewerRole,
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

describe('shifts nudge showing counter (1.4.2)', () => {
  it('POSITIVE: counts showings 1, 2, 3 per circle', async () => {
    const m = await import('@/lib/todayCoaching');
    expect(m.getShiftsNudgeShowCount('cx')).toBe(0);
    expect([1, 2, 3].map(() => m.recordShiftsNudgeShowing('cx'))).toEqual([1, 2, 3]);
    expect(m.getShiftsNudgeShowCount('cx')).toBe(3);
  });

  it('NEGATIVE: never counts past the cap, and one circle never affects another', async () => {
    const m = await import('@/lib/todayCoaching');
    for (let i = 0; i < 6; i++) m.recordShiftsNudgeShowing('cy');
    expect(m.getShiftsNudgeShowCount('cy')).toBe(m.SHIFTS_NUDGE_MAX_SHOWINGS);
    expect(m.getShiftsNudgeShowCount('cz')).toBe(0);
  });

  it('NEGATIVE: garbage in storage reads as 0 and throwing storage never throws', async () => {
    const m = await import('@/lib/todayCoaching');
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(m.getShiftsNudgeShowCount('cq')).toBe(0);
    spy.mockRestore();
  });
});

describe('role-aware next steps and the helper card (1.4.4)', () => {
  beforeEach(() => setUser('u1'));
  const ORDER = ['first_med', 'invite', 'reminders'] as const;

  it('POSITIVE: owner and recipient all three (the invite right is checked by the caller, as on mobile); manager invite + reminders', () => {
    expect(applicableNextSteps('owner', ORDER)).toEqual(['first_med', 'invite', 'reminders']);
    expect(applicableNextSteps('recipient', ORDER)).toEqual(['first_med', 'invite', 'reminders']);
    expect(applicableNextSteps('manager', ORDER)).toEqual(['invite', 'reminders']);
  });

  it('NEGATIVE: a helper has no setup step', () => {
    expect(applicableNextSteps('helper', ORDER)).toEqual([]);
    expect(nextStepViewerRole({ isOwner: false, isRecipient: false, canManageMembers: false })).toBe('helper');
    expect(nextStepViewerRole({ isOwner: true, isRecipient: true, canManageMembers: true })).toBe('owner');
  });

  it('helperCardBody: anything in Next up is "busy", an empty list is "quiet" (web never promises a push)', () => {
    expect(helperCardBody(0)).toBe('quiet');
    expect(helperCardBody(1)).toBe('busy');
    expect(helperCardBody(7)).toBe('busy');
  });

  it('helperCardAction: write access -> note; view-only -> care_team', () => {
    expect(helperCardAction(true)).toBe('note');
    expect(helperCardAction(false)).toBe('care_team');
  });

  it('POSITIVE: a dismissal persists per circle; NEGATIVE: not for another circle', () => {
    localStorage.clear();
    expect(hasDismissedHelperCard('c1')).toBe(false);
    dismissHelperCard('c1');
    expect(hasDismissedHelperCard('c1')).toBe(true);
    expect(hasDismissedHelperCard('c2')).toBe(false);
  });
});
