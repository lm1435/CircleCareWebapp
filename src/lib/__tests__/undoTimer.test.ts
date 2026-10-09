// The holdable commit timer behind every undo badge (WCAG 2.2.1).

import { startUndoTimer, UNDO_HOLD_CAP_MS } from '../undoTimer';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('startUndoTimer', () => {
  it('expires once, at the full window, when never held', () => {
    const onExpire = vi.fn();
    startUndoTimer(onExpire, 5000);
    vi.advanceTimersByTime(4999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('pauses while held and resumes with the time that was left', () => {
    const onExpire = vi.fn();
    const timer = startUndoTimer(onExpire, 5000);
    vi.advanceTimersByTime(2000);
    timer.hold(true);
    vi.advanceTimersByTime(30000); // well past 5 s, inside the 60 s cap
    expect(onExpire).not.toHaveBeenCalled();
    timer.hold(false);
    vi.advanceTimersByTime(2999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('adds up several holds: only un-held time counts', () => {
    const onExpire = vi.fn();
    const timer = startUndoTimer(onExpire, 5000);
    vi.advanceTimersByTime(1000); // 4 s left
    timer.hold(true);
    vi.advanceTimersByTime(4000);
    timer.hold(false);
    vi.advanceTimersByTime(2000); // 2 s left
    timer.hold(true);
    vi.advanceTimersByTime(2000);
    timer.hold(false);
    vi.advanceTimersByTime(1999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: a repeated hold(true) does not eat time, a repeated hold(false) does not restart', () => {
    const onExpire = vi.fn();
    const timer = startUndoTimer(onExpire, 5000);
    vi.advanceTimersByTime(1000);
    timer.hold(true);
    vi.advanceTimersByTime(3000);
    timer.hold(true);
    timer.hold(false);
    vi.advanceTimersByTime(2000);
    timer.hold(false); // must not re-arm a full 4 s from here
    vi.advanceTimersByTime(2000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('clear() cancels for good, held or not', () => {
    const onExpire = vi.fn();
    const timer = startUndoTimer(onExpire, 5000);
    timer.hold(true);
    timer.clear();
    timer.hold(false);
    vi.advanceTimersByTime(60000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  describe('the 60 s hold cap', () => {
    it('is 60 s', () => {
      expect(UNDO_HOLD_CAP_MS).toBe(60_000);
    });

    it('a hold that never releases still commits at 60 s from the press', () => {
      const onExpire = vi.fn();
      const timer = startUndoTimer(onExpire, 5000);
      vi.advanceTimersByTime(1000);
      timer.hold(true);
      vi.advanceTimersByTime(UNDO_HOLD_CAP_MS - 1000 - 1);
      expect(onExpire).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onExpire).toHaveBeenCalledTimes(1);
      timer.hold(false);
      vi.advanceTimersByTime(60_000);
      expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('a release before 60 s resumes the remaining time, and the cap never fires twice', () => {
      const onExpire = vi.fn();
      const timer = startUndoTimer(onExpire, 5000);
      vi.advanceTimersByTime(2000);
      timer.hold(true);
      vi.advanceTimersByTime(40_000); // t = 42 s
      timer.hold(false);
      vi.advanceTimersByTime(2999);
      expect(onExpire).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1); // t = 45 s: the 3 s that were left
      expect(onExpire).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(60_000);
      expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('Undo (clear) at 59 s while held cancels: the cap does not fire', () => {
      const onExpire = vi.fn();
      const timer = startUndoTimer(onExpire, 5000);
      timer.hold(true);
      vi.advanceTimersByTime(59_000);
      timer.clear();
      vi.advanceTimersByTime(120_000);
      expect(onExpire).not.toHaveBeenCalled();
    });
  });
});
