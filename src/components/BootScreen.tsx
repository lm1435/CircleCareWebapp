import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/** The status line ("Loading...") stays hidden this long, so a quick boot never flashes it. */
export const BOOT_STATUS_DELAY_MS = 3000;

/**
 * The ONE full-page boot state: `AuthGuard` while the refresh-cookie bootstrap runs, and
 * the fallback of the app-wide `<Suspense>` in `App.tsx`. Mirrors mobile's
 * `LoadingScreen` (fullscreen): the brand mark at the viewport centre, the "CircleCare"
 * wordmark hanging below it, a slow breath (1 -> 1.035, 2600 ms each way), and a status
 * line that only appears after `BOOT_STATUS_DELAY_MS`. No spinner, ring or dots.
 *
 * `useSuspense: false` is load-bearing, exactly as in `Spinner`: this is a Suspense
 * `fallback`, and a fallback that itself suspends on a locale chunk can never paint.
 *
 * The wordmark is an image of "CircleCare" set in Fraunces (the marketing site's serif),
 * the same file mobile ships, so both platforms show the identical lockup. "CircleCare"
 * is the product name and is never translated.
 *
 * Motion is CSS only (`.cc-boot-*` in globals.css), so the global
 * `prefers-reduced-motion` block stops it; the 3 s rule is the same either way.
 * Light/dark marks are switched by the `--logo-mark-*` role tokens (`data-theme`).
 */
export function BootScreen(): ReactElement {
  const { t } = useTranslation('common', { useSuspense: false });
  const label = t('loading');
  const [statusVisible, setStatusVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setStatusVisible(true), BOOT_STATUS_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <main className="relative min-h-screen bg-bg">
      {/* Top edge at 50% minus half the 120px mark: the MARK's centre is the viewport
          centre, and everything else hangs below it without moving it. */}
      <div
        role="status"
        aria-label={label}
        data-testid="boot-lockup"
        className="absolute inset-x-0 top-1/2 -mt-[60px] flex flex-col items-center px-8"
      >
        <div className="cc-boot-breath h-[120px] w-[120px]" data-testid="boot-mark-wrap">
          <img
            src="/logo-mark-384.png"
            alt=""
            width={120}
            height={120}
            className="cc-logo-mark-light h-[120px] w-[120px]"
            data-testid="boot-mark-light"
          />
          <img
            src="/logo-mark-dark-384.png"
            alt=""
            width={120}
            height={120}
            className="cc-logo-mark-dark h-[120px] w-[120px]"
            data-testid="boot-mark-dark"
          />
        </div>
        <img
          src="/circlecare-wordmark.png"
          alt="CircleCare"
          width={118}
          height={21}
          className="cc-logo-mark-light cc-boot-wordmark mt-[18px] h-[21px] w-[118px]"
        />
        <img
          src="/circlecare-wordmark-dark.png"
          alt="CircleCare"
          width={118}
          height={21}
          className="cc-logo-mark-dark cc-boot-wordmark mt-[18px] h-[21px] w-[118px]"
        />
        {statusVisible && (
          // The region's aria-label already says this; do not read it twice.
          <p
            aria-hidden="true"
            className="cc-boot-status mt-[14px] text-center text-md leading-[22px] text-ink-2"
          >
            {label}
          </p>
        )}
      </div>
    </main>
  );
}
