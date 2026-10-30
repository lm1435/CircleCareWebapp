import { useEffect, useState } from 'react';

// Large-text layout switch (docs/plans/simple-ui-1-3-1.md "Large text").
// Mobile switches on MEASURED fontScale; the web equivalent is what the user
// actually did to make text bigger, measured rather than guessed:
//   - browser zoom: the window's outer width over its CSS (inner) width. At
//     200% zoom a 1440 window has 720 CSS px, so the ratio is 2.
//   - a larger default font: the computed root font size (16px = 1x).
// Active at 1.5x or more on either, mobile's heading cap. Re-measured on
// resize, which is what a zoom change fires.

const ZOOM_THRESHOLD = 1.5;
const ROOT_FONT_THRESHOLD_PX = 24;
const BASE_ROOT_FONT_PX = 16;

export function measureLargeText(): boolean {
  if (typeof window === 'undefined') return false;
  const rootPx = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  if (Number.isFinite(rootPx) && rootPx >= ROOT_FONT_THRESHOLD_PX) return true;
  if (Number.isFinite(rootPx) && rootPx / BASE_ROOT_FONT_PX >= ZOOM_THRESHOLD) return true;
  const { outerWidth, innerWidth } = window;
  return innerWidth > 0 && outerWidth > 0 && outerWidth / innerWidth >= ZOOM_THRESHOLD * 1.25;
}

export function useLargeTextLayout(): boolean {
  const [active, setActive] = useState<boolean>(() => measureLargeText());
  useEffect(() => {
    const update = (): void => setActive(measureLargeText());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return active;
}

const reported = new Set<string>();

/** For tests: forget which screens already reported this session. */
export function resetLargeTextReports(): void {
  reported.clear();
}

/** True the first time `screen` asks in this session (once per screen per session). */
export function shouldReportLargeText(screen: string): boolean {
  if (reported.has(screen)) return false;
  reported.add(screen);
  return true;
}
