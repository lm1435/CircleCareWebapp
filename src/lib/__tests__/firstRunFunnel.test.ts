import { Analytics } from '@/lib/analytics';
import {
  ABANDON_DELAY_MS,
  durationBucket,
  firstRunFailReason,
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
let failed: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  resetFirstRunFunnelForTests();
  setVisibility('visible');
  viewed = vi.spyOn(Analytics, 'firstRunStepViewed').mockImplementation(() => {});
  completed = vi.spyOn(Analytics, 'firstRunStepCompleted').mockImplementation(() => {});
  abandoned = vi.spyOn(Analytics, 'firstRunAbandoned').mockImplementation(() => {});
  back = vi.spyOn(Analytics, 'firstRunBackTapped').mockImplementation(() => {});
  failed = vi.spyOn(Analytics, 'firstRunStepFailed').mockImplementation(() => {});
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

// first_run_step_failed (owner 2026-11-22): where a REQUIRED step's forward action fails, and why.
describe('firstRunFunnel.failed', () => {
  it('POSITIVE: reports the step, the closed reason and the run path', () => {
    setFirstRunPath('invited');
    firstRunFunnel.viewed('join');
    firstRunFunnel.failed('join', 'expired_code');
    expect(failed).toHaveBeenCalledWith('join', 'expired_code', 'invited');
  });

  it('POSITIVE: once per failed attempt (two refused codes are two signals)', () => {
    firstRunFunnel.viewed('code');
    firstRunFunnel.failed('code', 'invalid_code');
    firstRunFunnel.failed('code', 'invalid_code');
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('NEGATIVE: a failure does not count as a completion, and a completion sends no failure', () => {
    firstRunFunnel.viewed('account');
    firstRunFunnel.failed('account', 'network');
    expect(completed).not.toHaveBeenCalled();
    failed.mockClear();
    firstRunFunnel.completed('account');
    expect(failed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: never after Today was viewed', () => {
    firstRunFunnel.viewed('today');
    firstRunFunnel.failed('first_item', 'server');
    expect(failed).not.toHaveBeenCalled();
  });

  it('NEGATIVE: an analytics throw never reaches the caller', () => {
    failed.mockImplementation(() => {
      throw new Error('posthog down');
    });
    expect(() => firstRunFunnel.failed('who', 'validation')).not.toThrow();
  });
});

describe('firstRunFailReason', () => {
  const env = (code: string, message = 'whatever') => ({ success: false, error: { code, message } });
  it.each([
    [{ isAxiosError: true, message: 'Network Error', code: 'ERR_NETWORK' }, 'network'],
    [{ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' }, 'network'],
    [env('OFFLINE'), 'network'],
    [env('SERVER_ERROR'), 'server'],
    [{ status: 503, response: { status: 503 } }, 'server'],
    [env('VALIDATION_ERROR'), 'validation'],
    [env('VERIFICATION_FAILED'), 'invalid_code'],
    [env('INVALID_CODE'), 'invalid_code'],
    [env('INVITE_NOT_FOUND'), 'invalid_code'],
    [env('INVITE_EXPIRED'), 'expired_code'],
    [env('RATE_LIMIT'), 'rate_limited'],
    [env('AUTH_RATE_LIMITED'), 'rate_limited'],
    [env('EMAIL_RATE_LIMIT'), 'rate_limited'],
    [env('USER_EXISTS'), 'already_exists'],
    [env('INVITE_ALREADY_USED'), 'invite_invalid'],
    [env('CIRCLE_ARCHIVED'), 'invite_invalid'],
    [env('CARE_RECIPIENT_EXISTS'), 'invite_invalid'],
    [env('SUBSCRIPTION_REQUIRED'), 'seat_full'],
    [env('SOMETHING_NEW'), 'unknown'],
    [null, 'unknown'],
  ])('maps %j to %s', (err, reason) => {
    expect(firstRunFailReason(err)).toBe(reason);
  });

  it('NEGATIVE: a message carrying an address or a name never becomes the reason', () => {
    const reason = firstRunFailReason({ message: 'maria.lopez@example.com is already registered' });
    expect(reason).toBe('unknown');
  });
});

// Owner 2026-11-22 (mobile semantics): viewed is once per step per RUN; Back and return sends nothing new.
describe('firstRunFunnel viewed once per run', () => {
  it('NEGATIVE: who -> account -> Back -> who -> account sends who and account ONCE each', () => {
    firstRunFunnel.viewed('who');
    firstRunFunnel.viewed('account');
    firstRunFunnel.back('account');
    firstRunFunnel.viewed('who');
    firstRunFunnel.viewed('account');
    expect(viewed).toHaveBeenCalledTimes(2);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('POSITIVE: the abandon still names the step the person is ON after returning (not the first view)', () => {
    firstRunFunnel.viewed('who');
    firstRunFunnel.viewed('account');
    firstRunFunnel.viewed('who');
    setVisibility('hidden');
    vi.advanceTimersByTime(ABANDON_DELAY_MS);
    expect(abandoned).toHaveBeenCalledWith('who');
  });
});

describe('firstRunFunnel.skipped', () => {
  it('POSITIVE: the optional step left unsaved, once per run, with the path', () => {
    const skipped = vi.spyOn(Analytics, 'firstRunStepSkipped').mockImplementation(() => {});
    setFirstRunPath('apple');
    firstRunFunnel.viewed('first_item');
    firstRunFunnel.skipped('first_item');
    firstRunFunnel.skipped('first_item');
    expect(skipped).toHaveBeenCalledTimes(1);
    expect(skipped).toHaveBeenCalledWith('first_item', 'apple');
  });

  it('NEGATIVE: never once the step completed, never after Today', () => {
    const skipped = vi.spyOn(Analytics, 'firstRunStepSkipped').mockImplementation(() => {});
    firstRunFunnel.viewed('first_item');
    firstRunFunnel.completed('first_item');
    firstRunFunnel.skipped('first_item');
    resetFirstRunFunnelForTests();
    firstRunFunnel.viewed('today');
    firstRunFunnel.skipped('first_item');
    expect(skipped).not.toHaveBeenCalled();
  });
});
