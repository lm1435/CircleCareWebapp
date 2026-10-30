import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Analytics, type LargeTextScreen } from './analytics';

// Large-text support for the simple UI (docs/plans/simple-ui-1-3-1.md): time chips,
// pills and rows go to ONE column when the reader has enlarged text. Browser zoom
// already reflows through the viewport width; what zoom does not cover is a
// raised root font size (a larger "default font size" setting), which is what this
// measures.

/** Root font size (px) at which the layout counts as "large text" (150% of 16px). */
export const LARGE_TEXT_ROOT_PX = 24;

/** Below this container width (in rem) even normal text cannot fit two chips per line. */
const ONE_COLUMN_BELOW_REM = 17;
/** Below this container width (in rem) four chips per line do not fit. */
const TWO_COLUMNS_BELOW_REM = 30;

/** Pure: is this root font size "large text"? */
export function isLargeTextRoot(rootFontPx: number): boolean {
  return rootFontPx >= LARGE_TEXT_ROOT_PX;
}

/**
 * Pure: how many columns a row of `max` chips gets. Large text is always ONE;
 * otherwise by the container's width measured in rem (so it tracks text size too).
 */
export function chipColumns(rootFontPx: number, containerWidthPx: number, max: number): number {
  if (isLargeTextRoot(rootFontPx)) return 1;
  const rem = containerWidthPx / Math.max(1, rootFontPx);
  if (rem < ONE_COLUMN_BELOW_REM) return 1;
  if (rem < TWO_COLUMNS_BELOW_REM) return Math.min(2, max);
  return max;
}

function readRootFontPx(): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return 16;
  const px = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(px) && px > 0 ? px : 16;
}

/** Live "is the reader on large text" flag (root font size), re-read on resize. */
export function useLargeText(): boolean {
  const [large, setLarge] = useState(() => isLargeTextRoot(readRootFontPx()));
  useEffect(() => {
    const update = (): void => setLarge(isLargeTextRoot(readRootFontPx()));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return large;
}

/** Measured column count for a chip row: attach `ref` to the row's container. */
export function useChipColumns(max: number): { ref: RefObject<HTMLDivElement>; columns: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(max);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = (): void => {
      const width = el.clientWidth;
      const rootPx = readRootFontPx();
      // No layout yet (width 0, e.g. jsdom): large text still means one column.
      setColumns(width > 0 ? chipColumns(rootPx, width, max) : isLargeTextRoot(rootPx) ? 1 : max);
    };
    update();
    window.addEventListener('resize', update);
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(update);
      observer.observe(el);
    }
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [max]);
  return { ref, columns };
}

const reported = new Set<LargeTextScreen>();

/** Test hook: forget which screens already reported this session. */
export function resetLargeTextReports(): void {
  reported.clear();
}

/**
 * `large_text_layout` once per screen per session (tells us how many readers rely
 * on large text). Call from the screen once its layout is on screen.
 */
export function useLargeTextLayoutEvent(screen: LargeTextScreen, enabled = true): boolean {
  const active = useLargeText();
  useEffect(() => {
    if (!enabled || reported.has(screen)) return;
    reported.add(screen);
    Analytics.largeTextLayout(screen, active);
  }, [enabled, screen, active]);
  return active;
}
