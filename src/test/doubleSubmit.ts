import { act } from '@testing-library/react';

/**
 * Helpers for the double-submit regression tests that cover
 * `src/hooks/useGuardedSubmit.ts`.
 *
 * WHY NOT `userEvent.click(...)` TWICE
 * ------------------------------------
 * `userEvent` awaits between interactions, so React commits the first
 * submit's render before the second one is dispatched — by then the button is
 * `disabled` and the `isSubmitting` state flag is `true`, so a state-based
 * "fix" would pass such a test while the real bug (a second submit inside the
 * SAME tick, before React commits anything) went straight through.
 *
 * Both helpers below dispatch the two events inside ONE `act()`, with no await
 * between them. React batches, no render commits in between, and the only
 * thing that can reject the second call is a synchronous ref. That is exactly
 * the production failure — three `login_started` events in 52 ms — and it is
 * what these tests have to reproduce.
 *
 * Assert on the mocked API/mutation function's CALL COUNT. A test that only
 * checks the button ends up disabled proves nothing here.
 */

/**
 * Submits a form twice with no render commit in between.
 *
 * Resolves to `[firstPrevented, secondPrevented]`. `dispatchEvent` returns
 * `false` exactly when a listener called `preventDefault()`, and that answer is
 * load-bearing for the SECOND, REJECTED submit — which is why it is returned
 * rather than discarded. A guard that checks its ref BEFORE calling
 * `preventDefault` swallows the handler and lets the browser perform the
 * submission: on `LoginPage` that is a native GET to the current URL with
 * `name="email"` and `name="password"` in the query string, putting the
 * user's credentials into the address bar, browser history and the `Referer`
 * header — while navigating away mid-login. Callers that only care about the
 * call count can ignore the return value.
 */
export async function submitFormTwice(form: HTMLFormElement): Promise<[boolean, boolean]> {
  const prevented: boolean[] = [];
  await act(async () => {
    prevented.push(!form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    prevented.push(!form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  });
  return [prevented[0], prevented[1]];
}

/**
 * Clicks an element twice with no render commit in between.
 *
 * Resolves to `[firstPrevented, secondPrevented]` on the same terms as
 * `submitFormTwice` — `HTMLElement.click()` dispatches a cancelable event, so
 * the answer is available here too.
 */
export async function clickTwice(element: HTMLElement): Promise<[boolean, boolean]> {
  const prevented: boolean[] = [];
  await act(async () => {
    prevented.push(
      !element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    );
    prevented.push(
      !element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    );
  });
  return [prevented[0], prevented[1]];
}

/**
 * A promise that never settles — stands in for a request still in flight, so
 * the guard is still held when the second event arrives. Without it a `vi.fn()`
 * returning `undefined` resolves on the next microtask and the guard is
 * legitimately free again, which would make these tests pass for the wrong
 * reason.
 */
export function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}
