import { act, render, screen, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';
import { StoreReviewBanner, STORE_REVIEW_STATE_KEY } from '@/components/StoreReviewBanner';
import type { DevicePlatform } from '@/api/pushTokens';
import {
  QUIET_MS,
  __resetReviewMomentsForTests,
  noteReviewActivity,
  notePaywallShown,
  noteReviewBlockingError,
  raiseReviewMoment,
} from '@/lib/reviewMoments';

let platforms: DevicePlatform[] | undefined;
vi.mock('@/hooks/useDevicePlatforms', () => ({
  useDevicePlatforms: () => ({ data: platforms }),
}));

const analytics = vi.hoisted(() => ({
  reviewPromptShown: vi.fn(),
  storeReviewAskResolved: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ Analytics: analytics }));

const DAY_MS = 1000 * 60 * 60 * 24;

function seedState(state: Record<string, unknown>): void {
  window.localStorage.setItem(STORE_REVIEW_STATE_KEY, JSON.stringify(state));
}

function readState(): Record<string, unknown> {
  return JSON.parse(window.localStorage.getItem(STORE_REVIEW_STATE_KEY) ?? '{}');
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

/** A good moment, then the quiet period. */
function moment(trigger: Parameters<typeof raiseReviewMoment>[0] = 'shift_covered'): void {
  act(() => {
    raiseReviewMoment(trigger);
    vi.advanceTimersByTime(QUIET_MS + 1);
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  __resetReviewMomentsForTests();
  platforms = undefined;
  await i18n.changeLanguage('en');
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('StoreReviewBanner', () => {
  it('renders nothing for a web-only user (no registered devices), even at a moment', () => {
    platforms = [];
    render(<StoreReviewBanner />);
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORE_REVIEW_STATE_KEY)).toBeNull();
    expect(analytics.reviewPromptShown).not.toHaveBeenCalled();
  });

  it('renders nothing while platforms are still loading', () => {
    platforms = undefined;
    render(<StoreReviewBanner />);
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('first discovery of a device only starts the clock: no ask that visit, even at a moment', () => {
    platforms = ['ios'];
    render(<StoreReviewBanner />);
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    expect(typeof readState().firstSeenAt).toBe('string');
    expect(analytics.reviewPromptShown).not.toHaveBeenCalled();
  });

  it('an eligible user is NOT asked on a plain visit (no moment): the old time-only ask is gone', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(40) });
    render(<StoreReviewBanner />);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('shows at a moment after the quiet period and fires review_prompt_shown with the trigger', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);
    act(() => {
      raiseReviewMoment('member_joined');
      vi.advanceTimersByTime(QUIET_MS - 100);
    });
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId('store-review-banner')).toBeInTheDocument();
    expect(
      screen.getByText('Is CircleCare helping your family? A quick rating helps other caregivers find it.')
    ).toBeInTheDocument();
    expect(analytics.reviewPromptShown).toHaveBeenCalledTimes(1);
    expect(analytics.reviewPromptShown).toHaveBeenCalledWith('member_joined', 'ios');
    expect(typeof readState().lastShownAt).toBe('string');
  });

  it('never mid-batch: activity inside the quiet period pushes the banner back', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);
    act(() => {
      raiseReviewMoment('doses_week');
      for (let i = 0; i < 4; i++) {
        vi.advanceTimersByTime(QUIET_MS - 1000);
        noteReviewActivity();
      }
    });
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(QUIET_MS + 1);
    });
    expect(screen.getByTestId('store-review-banner')).toBeInTheDocument();
  });

  it('never right after a failure', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);
    act(() => noteReviewBlockingError());
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('never in a tab session that showed a paywall', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);
    act(() => notePaywallShown());
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('at most one showing per 30 days', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(100), lastShownAt: daysAgo(10) });
    render(<StoreReviewBanner />);
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('Rate opens the iOS write-review link, resolves as rated, and ends the ask for good', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<StoreReviewBanner />);
    moment();

    fireEvent.click(screen.getByRole('button', { name: 'Rate CircleCare' }));

    expect(open).toHaveBeenCalledWith(
      'https://apps.apple.com/app/id6757629684?action=write-review',
      '_blank',
      'noopener,noreferrer'
    );
    expect(analytics.storeReviewAskResolved).toHaveBeenCalledWith('rated', 'ios');
    expect(readState().done).toBe(true);
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('an Android-only user gets the Play listing link', () => {
    platforms = ['android'];
    seedState({ firstSeenAt: daysAgo(4) });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<StoreReviewBanner />);
    moment('alert_handled');

    expect(analytics.reviewPromptShown).toHaveBeenCalledWith('alert_handled', 'android');
    fireEvent.click(screen.getByRole('button', { name: 'Rate CircleCare' }));
    expect(open).toHaveBeenCalledWith(
      'https://play.google.com/store/apps/details?id=com.circlecare.circlecare',
      '_blank',
      'noopener,noreferrer'
    );
  });

  it('a user with both platforms is pointed at iOS', () => {
    platforms = ['android', 'ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);
    moment();
    expect(analytics.reviewPromptShown).toHaveBeenCalledWith('shift_covered', 'ios');
  });

  it('dismiss snoozes: resolved event fires, banner hides, count increments', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);
    moment();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(analytics.storeReviewAskResolved).toHaveBeenCalledWith('dismissed', 'ios');
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    const state = readState();
    expect(state.dismissCount).toBe(1);
    expect(typeof state.dismissedAt).toBe('string');
  });

  it('stays hidden during the 90-day snooze, returns after it (at a moment)', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(200), dismissedAt: daysAgo(30), dismissCount: 1 });
    const { unmount } = render(<StoreReviewBanner />);
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    unmount();

    __resetReviewMomentsForTests();
    seedState({ firstSeenAt: daysAgo(200), dismissedAt: daysAgo(91), dismissCount: 1 });
    render(<StoreReviewBanner />);
    moment();
    expect(screen.getByTestId('store-review-banner')).toBeInTheDocument();
  });

  it('three dismissals end the ask permanently', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(400), dismissedAt: daysAgo(200), dismissCount: 3 });
    render(<StoreReviewBanner />);
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('a done state never shows again', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(400), done: true });
    render(<StoreReviewBanner />);
    moment();
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    expect(analytics.reviewPromptShown).not.toHaveBeenCalled();
  });
});
