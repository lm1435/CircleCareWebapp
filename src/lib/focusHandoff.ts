/**
 * Focus hand-off for controls that REMOVE THEMSELVES (WCAG 2.4.3 focus order).
 *
 * A "Not now", "OK" or "Got it" button that unmounts its own card takes focus with it:
 * the browser silently resets `document.activeElement` to `<body>`, the next Tab restarts at
 * the top of the page and a screen reader loses its place. `handOffFocusSoon()` runs after
 * the click's React commit and, ONLY if focus really fell to nothing (a host that already
 * moved focus somewhere deliberate wins), moves it to the page's main heading.
 */

/** Focus is on nothing: `<body>`, no element, or a node that was just removed. */
export function focusIsLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body || !active.isConnected;
}

/**
 * Focus the page's `<h1>` inside `<main id="main">` (made programmatically focusable,
 * never a Tab stop), else `<main>` itself. Returns false when neither exists.
 */
export function focusMainHeading(): boolean {
  const main = document.getElementById('main');
  const target = (main ?? document).querySelector<HTMLElement>('h1') ?? main;
  if (!target) return false;
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return true;
}

/** After the current event's commit: if focus fell to nothing, move it to the main heading. */
export function handOffFocusSoon(): void {
  setTimeout(() => {
    if (focusIsLost()) focusMainHeading();
  }, 0);
}
