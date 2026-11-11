import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/** The status line ("Loading...") stays hidden this long, so a quick boot never flashes it. */
export const BOOT_STATUS_DELAY_MS = 3000;
const BREATH_CYCLE_MS = 5200;
const WORDMARK_FADE_DELAY_MS = 150;

/*
 * ONE boot screen, possibly two instances: AuthGuard's while the session bootstraps, then
 * the Suspense fallback while the first lazy page chunk loads. The state below lives at
 * module level so both draw the same moment in time: the second does not fade the
 * wordmark in again, restart the breath, or restart the status timer. A session ends once
 * no instance has been mounted for BOOT_SESSION_GAP_MS, so a later, unrelated load starts
 * fresh. Same rule as mobile's LoadingScreen.
 */
export const BOOT_SESSION_GAP_MS = 1000;
let bootSessionStart: number | null = null;
let bootInstances = 0;
let bootLastUnmountAt = 0;

/** The start time an instance rendering at `now` belongs to. Pure: safe during render. */
function peekBootSessionStart(now: number): number {
  const live =
    bootSessionStart !== null &&
    (bootInstances > 0 || now - bootLastUnmountAt <= BOOT_SESSION_GAP_MS);
  return live ? (bootSessionStart as number) : now;
}

export function __resetBootSessionForTests(): void {
  bootSessionStart = null;
  bootInstances = 0;
  bootLastUnmountAt = 0;
}

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
 * The wordmark is text in the app's own UI font (owner decision 2026-11-11: match the
 * app, not the marketing site's serif), at the same size, weight and tracking as mobile.
 * "CircleCare" is the product name and is never translated.
 *
 * Motion is CSS only (`.cc-boot-*` in globals.css), so the global
 * `prefers-reduced-motion` block stops it; the 3 s rule is the same either way.
 * Light/dark marks are switched by the `--logo-mark-*` role tokens (`data-theme`).
 */
export function BootScreen(): ReactElement {
  const { t } = useTranslation('common', { useSuspense: false });
  const label = t('loading');
  // Everything is timed from the boot SESSION's start, not this instance's mount.
  const [boot] = useState(() => {
    const now = Date.now();
    const start = peekBootSessionStart(now);
    return { start, elapsed: now - start };
  });
  const [statusVisible, setStatusVisible] = useState(boot.elapsed >= BOOT_STATUS_DELAY_MS);

  useEffect(() => {
    if (bootInstances === 0) bootSessionStart = boot.start;
    bootInstances += 1;
    return () => {
      bootInstances = Math.max(0, bootInstances - 1);
      if (bootInstances === 0) bootLastUnmountAt = Date.now();
    };
  }, [boot.start]);

  useEffect(() => {
    if (statusVisible) return;
    const remaining = boot.start + BOOT_STATUS_DELAY_MS - Date.now();
    const timer = window.setTimeout(() => setStatusVisible(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
    // Scheduled once per instance, from the session start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A negative animation-delay starts a CSS animation part-way through, so a later
  // instance carries on where the previous one was instead of starting over.
  const continued = boot.elapsed > 0;
  const breathStyle = continued
    ? { animationDelay: `-${boot.elapsed % BREATH_CYCLE_MS}ms` }
    : undefined;
  const wordmarkStyle = continued
    ? { animationDelay: `${WORDMARK_FADE_DELAY_MS - boot.elapsed}ms` }
    : undefined;

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
        <div
          className="cc-boot-breath h-[120px] w-[120px]"
          style={breathStyle}
          data-testid="boot-mark-wrap"
        >
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
        <p
          className="cc-boot-wordmark mt-3 whitespace-nowrap text-lg font-medium leading-[30px] tracking-[0.4px] text-ink"
          style={wordmarkStyle}
          data-testid="boot-wordmark"
        >
          CircleCare
        </p>
        {statusVisible && (
          // The region's aria-label already says this; do not read it twice.
          <p
            aria-hidden="true"
            className="cc-boot-status mt-2 text-center text-md leading-[22px] text-ink-2"
          >
            {label}
          </p>
        )}
      </div>
    </main>
  );
}
