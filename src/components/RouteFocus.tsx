import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Moves focus to the new page's main heading after an in-app page change
 * (WCAG 2.4.3 Focus Order). Without it, a link inside the page content unmounts
 * with the old page and focus falls to <body>: the next Tab restarts at the skip
 * link and a screen reader announces nothing about the new page.
 *
 * Rendered once in the router's root layout (next to RouteTitle). The rules:
 *  - Only a PATHNAME change is a page change. Search-only updates (calendar view,
 *    `?date=`) and hash-only jumps are the page's own business.
 *  - Never on the first load, and never before the visitor has pressed a key or
 *    a pointer: the boot redirect chain (`/` -> `/circles` -> …) is not a move.
 *  - A navigation to a `#hash` leaves focus to the page (DailyUpdatePage focuses
 *    `#tasks`, EditCirclePage `#danger`).
 *  - A page that manages its own focus says so in router state (`focusManaged`),
 *    or is the daily update's day arrows (`dailyUpdateArrow`, 71684d8).
 *  - Never steals focus from an open dialog, and never from a control the
 *    visitor (or the page) has focused since the navigation started.
 *  - `preventScroll`: the layout owns scrolling (AppLayout resets to the top).
 *
 * Target: the first `<h1>` in `<main>` (made programmatically focusable with
 * `tabIndex=-1`, so it never joins the Tab order), else `<main>` itself. Lazy
 * pages and data-loaded headings appear after the route commits, so it waits up
 * to WAIT_MS for the heading before falling back to `<main>`.
 */
const WAIT_MS = 2000;

type RouteState = { focusManaged?: boolean; dailyUpdateArrow?: unknown } | null;

function dialogOpen(): boolean {
  return Boolean(
    document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"], dialog[open]')
  );
}

function findHeading(): HTMLElement | null {
  const scope = document.querySelector('main') ?? document.body;
  const headings = Array.from(scope.querySelectorAll<HTMLElement>('h1'));
  return headings.find((h) => !h.closest('[role="dialog"], [role="alertdialog"], dialog')) ?? null;
}

export function RouteFocus(): null {
  const location = useLocation();
  const interacted = useRef(false);

  useEffect(() => {
    const mark = (): void => {
      interacted.current = true;
    };
    document.addEventListener('keydown', mark, true);
    document.addEventListener('pointerdown', mark, true);
    return () => {
      document.removeEventListener('keydown', mark, true);
      document.removeEventListener('pointerdown', mark, true);
    };
  }, []);

  useEffect(() => {
    // Runs on mount (first load: no interaction yet, so nothing moves) and on
    // every pathname change after it.
    if (!interacted.current || location.hash) return;
    const state = location.state as RouteState;
    if (state?.focusManaged || state?.dailyUpdateArrow) return;

    // What held focus as the page changed (often the clicked link, or <body> if
    // it already unmounted). Anything else focused later was a deliberate move.
    const startFocus = document.activeElement;
    let done = false;
    let frame = 0;

    const stillOurs = (): boolean => {
      const active = document.activeElement;
      if (!active || active === document.body) return true;
      if (active === startFocus) return true;
      // The clicked link went away with the old page.
      return !active.isConnected;
    };

    const land = (target: HTMLElement): void => {
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      // One frame later: the new page's own mount effects (a form's autofocus, a
      // dialog opening) run first and win.
      frame = window.requestAnimationFrame(() => {
        if (!target.isConnected || dialogOpen() || !stillOurs()) return;
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      });
    };

    const tryHeading = (): void => {
      if (done) return;
      const heading = findHeading();
      if (heading) land(heading);
    };

    const observer = new MutationObserver(tryHeading);
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = window.setTimeout(() => {
      if (done) return;
      const main = document.querySelector<HTMLElement>('main');
      if (main) land(main);
      else observer.disconnect();
    }, WAIT_MS);
    tryHeading();

    return () => {
      done = true;
      observer.disconnect();
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
    // Keyed on the PATHNAME only: a page that tidies its own query right after
    // arriving (NotesPage clearing `?date=`) must not cancel the pending move.
    // Hash and state are read from the same render as the pathname change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return null;
}
