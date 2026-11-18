import { Analytics } from '@/lib/analytics';
import {
  ABANDON_DELAY_MS,
  durationBucket,
  firstRunFunnel,
  resetFirstRunFunnelForTests,
  setFirstRunPath,
} from '../firstRunFunnel';

// First run v2 funnel (plan.md "Funnel"): once per step per run, abandon after 30s hidden, once per
// step, never after Today.

function setVisibility(state: 'hidden' | 'visible'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

let viewed: ReturnType<typeof vi.spyOn>;
let completed: ReturnType<typeof vi.spyOn>;
let abandoned: ReturnType<typeof vi.spyOn>;
let back: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  resetFirstRunFunnelForTests();
  setVisibility('visible');
  viewed = vi.spyOn(Analytics, 'firstRunStepViewed').mockImplementation(() => {});
  completed = vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
  abandoned = vi.spyOn(Analytics, 'firstRunAbandoned').mockImplementation(() => {});
  back = vi.spyOn(Analytics, 'firstRunBackTapped').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  resetFirstRunFunnelForTests();
});

describe('firstRunFunnel', () => {
  it('POSITIVE: each step is viewed once per run, with the path', () => {
    setFirstRunPath('google');
    firstRunFunnel.viewed('who');
    firstRunFunnel.viewed('who');
    firstRunFunnel.viewed('account');
    expect(viewed).toHaveBeenCalledTimes(2);
    expect(viewed).toHaveBeenNthCalledWith(1, undefined, 'who', 'google');
  });

  it('POSITIVE: completed carries the duration bucket since the step was viewed', () => {
    firstRunFunnel.viewed('who');
    vi.advanceTimersByTime(12_000);
    firstRunFunnel.completed('who');
    expect(completed).toHaveBeenCalledWith('who', '10_to_30s', 'email', undefined);
    expect(durationBucket(5_000)).toBe('under_10s');
    expect(durationBucket(200_000)).toBe('over_3m');
  });

  it('POSITIVE: back is reported for the step', () => {
    firstRunFunnel.viewed('account');
    firstRunFunnel.back('account');
    expect(back).toHaveBeenCalledWith('account');
  });

  it('POSITIVE: hidden for 30 s mid-run sends one abandon for the last step', () => {
    firstRunFunnel.viewed('code');
    setVisibility('hidden');
    vi.advanceTimersByTime(ABANDON_DELAY_MS);
    expect(abandoned).toHaveBeenCalledWith('code');
  });

  it('NEGATIVE: coming back within 30 s (the trip to the inbox for the code) sends nothing', () => {
    firstRunFunnel.viewed('code');
    setVisibility('hidden');
    vi.advanceTimersByTime(ABANDON_DELAY_MS - 1);
    setVisibility('visible');
    vi.advanceTimersByTime(ABANDON_DELAY_MS * 2);
    expect(abandoned).not.toHaveBeenCalled();
  });

  it('NEGATIVE: at most one abandon per step', () => {
    firstRunFunnel.viewed('code');
    setVisibility('hidden');
    vi.advanceTimersByTime(ABANDON_DELAY_MS);
    setVisibility('visible');
    setVisibility('hidden');
    vi.advanceTimersByTime(ABANDON_DELAY_MS);
    expect(abandoned).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE: never after Today was viewed', () => {
    firstRunFunnel.viewed('all_set');
    firstRunFunnel.viewed('today');
    setVisibility('hidden');
    vi.advanceTimersByTime(ABANDON_DELAY_MS * 2);
    window.dispatchEvent(new Event('pagehide'));
    expect(abandoned).not.toHaveBeenCalled();
    firstRunFunnel.completed('all_set');
    expect(completed).not.toHaveBeenCalled();
  });
});
