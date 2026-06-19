import { useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

// TODO: replace placeholder store URLs with the real CircleCare
// App Store / Play Store listing IDs once published.
const APP_STORE_URL = 'https://apps.apple.com/';
const PLAY_STORE_URL = 'https://play.google.com/';

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

// Session-only dismissal — in-memory by design (never storage; web threat
// model keeps JS-readable storage empty). Resets on full page reload.
let dismissedThisSession = false;

/** Test-only helper — resets the module-level session dismissal flag. */
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
  // Captured once on mount: if already dismissed this session, render nothing.
  const initiallyDismissed = useRef(dismissedThisSession).current;
  const [dismissed, setDismissed] = useState(dismissedThisSession);
  const [{ isMobile, platform }] = useState(detectMobile);

  if (initiallyDismissed) return null;

  const handleDismiss = (): void => {
    dismissedThisSession = true;
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
        {isMobile ? (
          <div
            role="region"
            aria-label={t('downloadBanner.regionLabel')}
            data-variant="smart"
            className="flex items-center gap-3 bg-ink px-4 py-2 text-cream"
          >
            <p className="m-0 min-w-0 flex-1 text-sm leading-snug">
              {t('downloadBanner.mobileMessage')}
            </p>
            {platform !== null ? (
              <a
                href={singleStoreUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-terracotta min-h-11 shrink-0 px-4 py-2 text-sm"
              >
                {t('downloadBanner.getApp')}
              </a>
            ) : (
              <span className="flex shrink-0 items-center gap-3">
                <a
                  href={APP_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center text-sm font-medium text-cream underline"
                >
                  {t('downloadApp.appStore')}
                </a>
                <a
                  href={PLAY_STORE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center text-sm font-medium text-cream underline"
                >
                  {t('downloadApp.googlePlay')}
                </a>
              </span>
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
        ) : (
          <div
            role="region"
            aria-label={t('downloadBanner.regionLabel')}
            data-variant="subtle"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-0 border-b border-line bg-bg-2 px-4 py-1"
          >
            <p className="m-0 text-sm text-ink-2">{t('downloadBanner.message')}</p>
            <a
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-medium text-terracotta-deep underline transition-colors hover:text-ink"
            >
              {t('downloadApp.appStore')}
            </a>
            <a
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-medium text-terracotta-deep underline transition-colors hover:text-ink"
            >
              {t('downloadApp.googlePlay')}
            </a>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={t('downloadBanner.dismiss')}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-3 hover:text-ink"
            >
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
