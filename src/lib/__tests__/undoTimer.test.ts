// The holdable commit timer behind every undo badge (WCAG 2.2.1).

import { startUndoTimer } from '../undoTimer';

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
    vi.advanceTimersByTime(60000);
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
});
