import { act, renderHook } from '@testing-library/react';
import { useDailyUpdateWindow } from '../useDailyUpdate';

/**
 * Window hook twins of mobile's useDailyUpdate cases (plan §8.2/§8.3): before 19:00
 * hidden, 19:00 shown, midnight hidden WHILE MOUNTED, tab-resume re-evaluates, and a
 * viewer clock in a different zone than the recipient changes nothing. The clock is
 * injected with fake timers; the machine zone (Denver) never matters.
 */
/**
 * Advance the fake clock in steps no longer than one boundary timer, flushing React
 * between steps: each timer is re-armed by an effect AFTER the render it causes, so a
 * single long `advanceTimersByTime` would only ever fire the first one.
 */
function advance(ms: number): void {
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, 10 * 60 * 1000);
    act(() => {
      vi.advanceTimersByTime(step);
    });
    left -= step;
  }
}

describe('useDailyUpdateWindow', () => {
  afterEach(() => vi.useRealTimers());

  it('opens at 19:00 and closes at midnight while the tab stays open (New York)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T22:59:30Z')); // 18:59:30 EDT
    const { result } = renderHook(() => useDailyUpdateWindow('America/New_York'));
    expect(result.current).toMatchObject({ inWindow: false, localDate: '2026-10-08' });

    act(() => {
      vi.advanceTimersByTime(30_000); // 19:00:00
    });
    expect(result.current).toMatchObject({ inWindow: true, localDate: '2026-10-08' });

    // Walk to 23:59:59 in capped steps; still open.
    advance(4 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59_000);
    expect(result.current).toMatchObject({ inWindow: true, localDate: '2026-10-08' });

    act(() => {
      vi.advanceTimersByTime(1_000); // midnight
    });
    expect(result.current).toMatchObject({ inWindow: false, localDate: '2026-10-09' });
  });

  it.each([
    ['Asia/Kolkata', '2026-10-08T13:29:00Z', '2026-10-08T18:30:00Z'],
    ['Pacific/Auckland', '2026-10-08T05:59:00Z', '2026-10-08T11:00:00Z'],
  ])('%s: opens and closes on the recipient clock', (tz, at1859, atMidnight) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at1859));
    const { result } = renderHook(() => useDailyUpdateWindow(tz));
    expect(result.current?.inWindow).toBe(false);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current?.inWindow).toBe(true);
    advance(new Date(atMidnight).getTime() - new Date(at1859).getTime() - 60_000);
    expect(result.current?.inWindow).toBe(false);
    expect(result.current?.localDate).toBe('2026-10-09');
  });

  it('re-evaluates when the tab becomes visible again (timers do not run in the background)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T20:00:00Z')); // 16:00 EDT
    const { result } = renderHook(() => useDailyUpdateWindow('America/New_York'));
    expect(result.current?.inWindow).toBe(false);

    // The clock jumps (laptop asleep) without any timer firing.
    vi.setSystemTime(new Date('2026-10-09T00:30:00Z')); // 20:30 EDT
    expect(result.current?.inWindow).toBe(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current?.inWindow).toBe(true);
  });

  it('is null until the recipient zone is known', () => {
    const { result } = renderHook(() => useDailyUpdateWindow(null));
    expect(result.current).toBeNull();
  });
});
