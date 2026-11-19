import { useEffect, useRef, useState, type ReactElement } from 'react';
import { prefersReducedMotion } from './motion';

/**
 * The "this is the item you came for" ring (mobile twin: DeepLinkHighlightRing): a 2px moss border that fades in
 * (200 ms), holds (1100 ms) and fades out (450 ms), never a fill and never a selected state. Under
 * `prefers-reduced-motion` it shows outright for the same total time with NO fade.
 *
 * Render it as the LAST child of the item's container, which must be `position: relative`. On mount it scrolls
 * that container into view with `block: 'nearest'` (it moves the page only by what is hidden). `onDone` fires
 * once the ring has run, so the caller can clear the highlight and a re-focus never replays it.
 */
export const HIGHLIGHT_IN_MS = 200;
export const HIGHLIGHT_HOLD_MS = 1100;
export const HIGHLIGHT_OUT_MS = 450;
export const HIGHLIGHT_TOTAL_MS = HIGHLIGHT_IN_MS + HIGHLIGHT_HOLD_MS + HIGHLIGHT_OUT_MS;

export function HighlightRing({
  onDone,
  className = 'rounded-xl',
  testId = 'highlight-ring',
}: {
  onDone?: () => void;
  /** Corner radius utility so the ring follows the item's corners. */
  className?: string;
  testId?: string;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = prefersReducedMotion();
  const [visible, setVisible] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    ref.current?.parentElement?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    const timers: number[] = [];
    if (reduced) {
      setVisible(true);
      timers.push(
        window.setTimeout(() => {
          setVisible(false);
          doneRef.current?.();
        }, HIGHLIGHT_TOTAL_MS)
      );
    } else {
      timers.push(window.setTimeout(() => setVisible(true), 0));
      timers.push(window.setTimeout(() => setVisible(false), HIGHLIGHT_IN_MS + HIGHLIGHT_HOLD_MS));
      timers.push(window.setTimeout(() => doneRef.current?.(), HIGHLIGHT_TOTAL_MS));
    }
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [reduced]);

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-testid={testId}
      data-state={visible ? 'on' : 'off'}
      data-reduced-motion={reduced ? 'true' : 'false'}
      className={`pointer-events-none absolute -inset-x-2 -inset-y-0.5 border-2 border-moss ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: reduced ? 'none' : `opacity ${visible ? HIGHLIGHT_IN_MS : HIGHLIGHT_OUT_MS}ms linear`,
      }}
    />
  );
}
