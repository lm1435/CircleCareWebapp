import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useDevicePlatforms } from '@/hooks/useDevicePlatforms';
import { Analytics } from '@/lib/analytics';
import type { DevicePlatform } from '@/api/pushTokens';

export const STORE_REVIEW_STATE_KEY = 'cc_store_review_state';

/** Store listing review links. iOS `action=write-review` opens the rating
 *  sheet directly; Play has no web equivalent, so Android lands on the listing. */
const STORE_LINKS: Record<DevicePlatform, string> = {
  ios: 'https://apps.apple.com/app/id6757629684?action=write-review',
  android: 'https://play.google.com/store/apps/details?id=com.circlecare.circlecare',
};

const MIN_DAYS_SINCE_FIRST_SEEN = 3;
const SNOOZE_DAYS_AFTER_DISMISS = 90;
const MAX_DISMISSALS = 3;
const DAY_MS = 1000 * 60 * 60 * 24;

interface StoreReviewState {
  firstSeenAt?: string;
  dismissedAt?: string;
  dismissCount?: number;
  done?: boolean;
}

function readState(): StoreReviewState {
  try {
    const raw = window.localStorage.getItem(STORE_REVIEW_STATE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StoreReviewState) : {};
  } catch {
    // Unreadable state fails CLOSED (treated as done below would be ideal, but
    // an empty object only re-arms the 3-day clock — the OS caps don't exist on
    // web, so the worst case is one extra ask).
    return {};
  }
}

function writeState(state: StoreReviewState): void {
  try {
    window.localStorage.setItem(STORE_REVIEW_STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage blocked: decisions still hold for this page's lifetime via setState.
  }
}

function eligible(state: StoreReviewState, now: Date): boolean {
  if (state.done) return false;
  if ((state.dismissCount ?? 0) >= MAX_DISMISSALS) return false;
  if (state.dismissedAt) {
    const days = (now.getTime() - new Date(state.dismissedAt).getTime()) / DAY_MS;
    if (!(days >= SNOOZE_DAYS_AFTER_DISMISS)) return false;
  }
  if (!state.firstSeenAt) return false;
  const sinceFirst = (now.getTime() - new Date(state.firstSeenAt).getTime()) / DAY_MS;
  return sinceFirst >= MIN_DAYS_SINCE_FIRST_SEEN;
}

/**
 * Dismissible, NON-modal strip asking an APP user to rate CircleCare on their
 * store. Web-only on purpose: mobile has the native StoreKit/Play prompt, but
 * the OS decides whether that ever displays — this web ask is the one path with
 * no silent suppression. Gates:
 *  - the user has the app (an active push token row → `useDevicePlatforms`);
 *    a web-only user is NEVER asked — there is nothing for them to rate;
 *  - first eligibility only starts a 3-day clock (no ask on the visit that
 *    discovers the device), mirroring mobile's "not on day one" spirit;
 *  - dismiss snoozes 90 days, 3 dismissals end it, rating ends it.
 * State is per-browser localStorage: independent of mobile's install budget,
 * which the OS enforces separately anyway.
 */
export function StoreReviewBanner(): ReactElement | null {
  const { t } = useTranslation('common');
  const { data: platforms } = useDevicePlatforms();
  const [state, setState] = useState<StoreReviewState>(readState);
  const shown = useRef(false);

  // Ratings are thinnest on the App Store (see docs/aso-strategy.md), so a
  // user with both platforms is pointed at iOS.
  const platform: DevicePlatform | null =
    platforms && platforms.length > 0 ? (platforms.includes('ios') ? 'ios' : 'android') : null;

  // Discovering a device for the first time starts the clock; the banner
  // itself waits MIN_DAYS_SINCE_FIRST_SEEN.
  useEffect(() => {
    if (!platform || state.firstSeenAt) return;
    const next = { ...state, firstSeenAt: new Date().toISOString() };
    writeState(next);
    setState(next);
  }, [platform, state]);

  const visible = platform !== null && eligible(state, new Date());

  useEffect(() => {
    if (visible && platform && !shown.current) {
      shown.current = true;
      Analytics.storeReviewAskShown(platform);
    }
  }, [visible, platform]);

  if (!visible || !platform) return null;

  const resolve = (action: 'rated' | 'dismissed'): void => {
    Analytics.storeReviewAskResolved(action, platform);
    const next: StoreReviewState =
      action === 'rated'
        ? { ...state, done: true }
        : {
            ...state,
            dismissedAt: new Date().toISOString(),
            dismissCount: (state.dismissCount ?? 0) + 1,
          };
    writeState(next);
    setState(next);
  };

  return (
    <div
      data-testid="store-review-banner"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line bg-dusk-soft px-4 py-2 sm:px-6 animate-[fade-in_200ms_ease-out] motion-reduce:animate-none"
    >
      <p className="min-w-0 text-sm leading-snug text-ink">{t('storeReviewBanner.message')}</p>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          onClick={() => {
            window.open(STORE_LINKS[platform], '_blank', 'noopener,noreferrer');
            resolve('rated');
          }}
          className="focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t('storeReviewBanner.rate')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => resolve('dismissed')}>
          {t('storeReviewBanner.dismiss')}
        </Button>
      </div>
    </div>
  );
}
