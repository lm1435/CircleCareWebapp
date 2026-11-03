/**
 * lib/reviewMoments.ts: the four store-review moments on web (mobile parity
 * with services/storeReview.ts + reviewSignals.ts), feeding StoreReviewBanner.
 */
import {
  DOSE_DAYS_KEY,
  MEMBER_BASELINE_KEY,
  QUIET_MS,
  __resetReviewMomentsForTests,
  consumeReviewMoment,
  getReadyReviewTrigger,
  noteAlertOpened,
  noteDoseAnswered,
  notePaywallShown,
  noteReviewBlockingError,
  observeCircleMembers,
  raiseReviewMoment,
  subscribeReviewMoments,
} from '@/lib/reviewMoments';

const NOW = new Date(2026, 10, 3, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  __resetReviewMomentsForTests();
});
afterEach(() => vi.useRealTimers());

const quiet = () => vi.advanceTimersByTime(QUIET_MS + 1);

describe('a moment becomes ready only after the quiet period', () => {
  it('ready after QUIET_MS, and listeners hear it', () => {
    const l = vi.fn();
    const off = subscribeReviewMoments(l);
    raiseReviewMoment('shift_covered');
    vi.advanceTimersByTime(QUIET_MS - 1);
    expect(getReadyReviewTrigger()).toBeNull();
    vi.advanceTimersByTime(2);
    expect(getReadyReviewTrigger()).toBe('shift_covered');
    expect(l).toHaveBeenCalledTimes(1);
    off();
  });

  it('coalesces: the first trigger in a window wins', () => {
    raiseReviewMoment('member_joined');
    raiseReviewMoment('doses_week');
    quiet();
    expect(getReadyReviewTrigger()).toBe('member_joined');
  });

  it('consume spends it', () => {
    raiseReviewMoment('member_joined');
    quiet();
    consumeReviewMoment();
    expect(getReadyReviewTrigger()).toBeNull();
  });

  it('a recent failure suppresses it', () => {
    noteReviewBlockingError();
    raiseReviewMoment('member_joined');
    quiet();
    expect(getReadyReviewTrigger()).toBeNull();
  });

  it('a paywall in this tab session suppresses it, also one already ready', () => {
    raiseReviewMoment('member_joined');
    quiet();
    notePaywallShown();
    expect(getReadyReviewTrigger()).toBeNull();
    raiseReviewMoment('shift_covered');
    quiet();
    expect(getReadyReviewTrigger()).toBeNull();
    expect(window.sessionStorage.getItem('cc_review_paywall_session')).toBe('1');
  });
});

describe('a week of doses', () => {
  const sixDays = () =>
    window.localStorage.setItem(
      DOSE_DAYS_KEY,
      JSON.stringify([6, 5, 4, 3, 2, 1].map((n) => localDay(new Date(NOW.getTime() - n * DAY))))
    );

  it('the taken dose that makes the 7th distinct day is the moment', () => {
    sixDays();
    noteDoseAnswered('c1', 'taken');
    quiet();
    expect(getReadyReviewTrigger()).toBe('doses_week');
  });

  it('a skip does not add a day; a second dose the same day is not a second moment', () => {
    sixDays();
    noteDoseAnswered('c1', 'skipped');
    quiet();
    expect(getReadyReviewTrigger()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(DOSE_DAYS_KEY)!)).toHaveLength(6);
    noteDoseAnswered('c1', 'taken');
    quiet();
    consumeReviewMoment();
    noteDoseAnswered('c1', 'taken');
    quiet();
    expect(getReadyReviewTrigger()).toBeNull();
  });
});

describe('alert handled', () => {
  it('answering a dose in the circle whose alert was opened', () => {
    noteAlertOpened('c1');
    vi.advanceTimersByTime(60_000);
    noteDoseAnswered('c1', 'skipped');
    quiet();
    expect(getReadyReviewTrigger()).toBe('alert_handled');
  });

  it('not another circle, not after 30 minutes', () => {
    noteAlertOpened('c1');
    noteDoseAnswered('c2', 'taken');
    vi.advanceTimersByTime(31 * 60 * 1000);
    noteDoseAnswered('c1', 'taken');
    quiet();
    expect(getReadyReviewTrigger()).toBeNull();
  });
});

describe('first person joins an owned circle', () => {
  it('first sighting is a baseline; 1 -> 2 is the moment; members-only circles never count', () => {
    observeCircleMembers([{ id: 'a', role: 'owner', member_count: 1 }, { id: 'b', role: 'member', member_count: 1 }]);
    quiet();
    expect(getReadyReviewTrigger()).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(MEMBER_BASELINE_KEY)!)).toEqual({ a: 1 });
    observeCircleMembers([{ id: 'a', role: 'owner', member_count: 2 }, { id: 'b', role: 'member', member_count: 3 }]);
    quiet();
    expect(getReadyReviewTrigger()).toBe('member_joined');
  });

  it('an owner whose circle already had members is never asked on load', () => {
    observeCircleMembers([{ id: 'a', role: 'owner', member_count: 3 }]);
    observeCircleMembers([{ id: 'a', role: 'owner', member_count: 4 }]);
    quiet();
    expect(getReadyReviewTrigger()).toBeNull();
  });
});
