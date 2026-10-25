import { render, screen, fireEvent } from '@testing-library/react';
import i18n from '@/i18n';
import { StoreReviewBanner, STORE_REVIEW_STATE_KEY } from '@/components/StoreReviewBanner';
import type { DevicePlatform } from '@/api/pushTokens';

let platforms: DevicePlatform[] | undefined;
vi.mock('@/hooks/useDevicePlatforms', () => ({
  useDevicePlatforms: () => ({ data: platforms }),
}));

const analytics = vi.hoisted(() => ({
  storeReviewAskShown: vi.fn(),
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

beforeEach(async () => {
  vi.clearAllMocks();
  window.localStorage.clear();
  platforms = undefined;
  await i18n.changeLanguage('en');
});

describe('StoreReviewBanner', () => {
  it('renders nothing for a web-only user (no registered devices) and stores no state', () => {
    platforms = [];
    render(<StoreReviewBanner />);
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    expect(window.localStorage.getItem(STORE_REVIEW_STATE_KEY)).toBeNull();
    expect(analytics.storeReviewAskShown).not.toHaveBeenCalled();
  });

  it('renders nothing while platforms are still loading', () => {
    platforms = undefined;
    render(<StoreReviewBanner />);
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('first discovery of a device only starts the clock — no ask that visit', () => {
    platforms = ['ios'];
    render(<StoreReviewBanner />);
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    expect(typeof readState().firstSeenAt).toBe('string');
    expect(analytics.storeReviewAskShown).not.toHaveBeenCalled();
  });

  it('shows after the 3-day clock and fires store_review_ask_shown once', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);
    expect(screen.getByTestId('store-review-banner')).toBeInTheDocument();
    expect(
      screen.getByText('Is CircleCare helping your family? A quick rating helps other caregivers find it.')
    ).toBeInTheDocument();
    expect(analytics.storeReviewAskShown).toHaveBeenCalledTimes(1);
    expect(analytics.storeReviewAskShown).toHaveBeenCalledWith('ios');
  });

  it('Rate opens the iOS write-review link, resolves as rated, and ends the ask for good', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<StoreReviewBanner />);

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

    expect(analytics.storeReviewAskShown).toHaveBeenCalledWith('android');
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
    expect(analytics.storeReviewAskShown).toHaveBeenCalledWith('ios');
  });

  it('dismiss snoozes: resolved event fires, banner hides, count increments', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(4) });
    render(<StoreReviewBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(analytics.storeReviewAskResolved).toHaveBeenCalledWith('dismissed', 'ios');
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    const state = readState();
    expect(state.dismissCount).toBe(1);
    expect(typeof state.dismissedAt).toBe('string');
  });

  it('stays hidden during the 90-day snooze, returns after it', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(200), dismissedAt: daysAgo(30), dismissCount: 1 });
    const { unmount } = render(<StoreReviewBanner />);
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    unmount();

    seedState({ firstSeenAt: daysAgo(200), dismissedAt: daysAgo(91), dismissCount: 1 });
    render(<StoreReviewBanner />);
    expect(screen.getByTestId('store-review-banner')).toBeInTheDocument();
  });

  it('three dismissals end the ask permanently', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(400), dismissedAt: daysAgo(200), dismissCount: 3 });
    render(<StoreReviewBanner />);
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
  });

  it('a done state never shows again', () => {
    platforms = ['ios'];
    seedState({ firstSeenAt: daysAgo(400), done: true });
    render(<StoreReviewBanner />);
    expect(screen.queryByTestId('store-review-banner')).not.toBeInTheDocument();
    expect(analytics.storeReviewAskShown).not.toHaveBeenCalled();
  });
});
