/**
 * Shared exit-animation plumbing for Modal and Toast (spec §4.5).
 *
 * Both play a 160ms `modal-out` and hold the node in the tree until the
 * animation actually ends, with a fallback timer as the safety net for a
 * browser that never fires `animationend` (a backgrounded tab, a dropped
 * animation, jsdom under test). Extracted so the constant, the
 * reduced-motion check, and the listener+timer idiom exist in exactly one
 * place instead of being retyped identically in both components.
 */

/**
 * `modal-out` runs for 160ms; a timer slightly longer than the animation
 * retires the node if `animationend` never arrives.
 */
export const EXIT_FALLBACK_MS = 200;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Calls `cb` once — on the element's own `animationend`, or on a
 * `EXIT_FALLBACK_MS` timer, whichever comes first — and returns a cleanup
 * that removes the listener and clears the timer.
 *
 * A native listener, not React's `onAnimationEnd`: React resolves the
 * animation event name once at load time and falls back to the `webkit`
 * prefix wherever `AnimationEvent` is missing from `window` (jsdom), so the
 * React prop silently never fires under test while working in the browser.
 *
 * Only the element's OWN exit retires it — an `animationend` bubbling up
 * from something animated inside it (a child, a toast action) must not
 * trigger `cb`, so the listener checks `event.target` against `el`.
 */
export function waitForExitAnimation(el: HTMLElement | null, cb: () => void): () => void {
  const onAnimationEnd = (event: Event): void => {
    if (event.target !== el) return;
    cb();
  };
  el?.addEventListener('animationend', onAnimationEnd);
  const timer = window.setTimeout(cb, EXIT_FALLBACK_MS);
  return () => {
    el?.removeEventListener('animationend', onAnimationEnd);
    window.clearTimeout(timer);
  };
}
