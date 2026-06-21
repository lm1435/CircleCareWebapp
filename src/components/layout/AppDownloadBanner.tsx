import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/storeLinks';
import { AppleGlyph, GooglePlayGlyph } from './StoreBadges';

interface MobileDetection {
  isMobile: boolean;
  platform: 'ios' | 'android' | null;
}

function detectMobile(): MobileDetection {
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return { isMobile: true, platform: 'ios' };
    if (/Android/i.test(ua)) return { isMobile: true, platform: 'android' };
  }
  // Heuristic fallback for UA-frozen browsers: coarse pointer + narrow viewport.
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches &&
    window.innerWidth < 768
  ) {
    return { isMobile: true, platform: null };
  }
  return { isMobile: false, platform: null };
}

// Dismissal persists across reloads via localStorage. This is a non-sensitive
// UI preference, not a secret — the "keep JS-readable storage empty" rule is
// specifically about auth tokens, which still never touch storage. An in-memory
// flag mirrors it so a dismiss takes effect instantly without a storage read.
const DISMISS_KEY = 'cc-download-banner-dismissed';
let dismissedThisSession = false;

function isBannerDismissed(): boolean {
  if (dismissedThisSession) return true;
  try {
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Test-only helper — resets the in-memory dismissal flag (simulates a reload). */
export function resetAppDownloadBannerDismissal(): void {
  dismissedThisSession = false;
}

function CloseIcon(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Dismissible app-download banner (plan Task 14). Subtle strip on desktop;
 * prominent smart-banner style on mobile browsers. Dismissal animates the
 * banner height closed (grid-rows trick) so the layout never jumps.
 */
export function AppDownloadBanner(): ReactElement | null {
  const { t } = useTranslation('common');
  // Captured once on mount: if already dismissed (this session or a prior visit),
  // render nothing.
  const initiallyDismissed = useRef(isBannerDismissed()).current;
  const [dismissed, setDismissed] = useState(initiallyDismissed);
  const [{ platform }] = useState(detectMobile);

  if (initiallyDismissed) return null;

  const handleDismiss = (): void => {
    dismissedThisSession = true;
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // Storage unavailable (private mode / blocked) — fall back to session-only.
    }
    setDismissed(true);
  };

  const singleStoreUrl = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;

  return (
    <div
      aria-hidden={dismissed || undefined}
      className={`grid transition-[grid-template-rows,visibility] duration-300 ${
        dismissed ? 'invisible grid-rows-[0fr]' : 'grid-rows-[1fr]'
      }`}
    >
      <div className="min-h-0 overflow-hidden">
        {/* One prominent dark banner at every breakpoint (plan Task 14 originally
            split mobile/desktop variants; unified per design). On mobile the
            platform is known, so it deep-links with a single "Get the app"
            button; on desktop both store buttons are shown. */}
        <div
          role="region"
          aria-label={t('downloadBanner.regionLabel')}
          data-variant="prominent"
          className="flex items-center gap-3 bg-ink px-4 py-2 text-cream sm:px-6"
        >
          <p className="m-0 min-w-0 flex-1 text-sm leading-snug">
            {t('downloadBanner.mobileMessage')}
          </p>
          {platform !== null ? (
            <a
              href={singleStoreUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-terracotta min-h-11 shrink-0 gap-2 px-4 py-2 text-sm"
            >
              {platform === 'ios' ? (
                <AppleGlyph className="h-4 w-4 shrink-0" />
              ) : (
                <GooglePlayGlyph className="h-4 w-4 shrink-0" />
              )}
              {t('downloadBanner.getApp')}
            </a>
          ) : (
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('downloadApp.appStore')}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cream/30 px-3.5 text-sm font-medium text-cream transition-colors hover:bg-cream/10"
              >
                <AppleGlyph className="h-4 w-4 shrink-0" />
                {t('downloadApp.appStoreName')}
              </a>
              <a
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('downloadApp.googlePlay')}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cream/30 px-3.5 text-sm font-medium text-cream transition-colors hover:bg-cream/10"
              >
                <GooglePlayGlyph className="h-4 w-4 shrink-0" />
                {t('downloadApp.playName')}
              </a>
            </div>
          )}
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t('downloadBanner.dismiss')}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cream transition-colors hover:bg-ink-2"
          >
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
