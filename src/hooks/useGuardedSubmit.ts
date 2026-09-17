import { useCallback, useMemo, useRef } from 'react';

/**
 * Double-submit guards for the web app — the browser twin of
 * `mobile/src/hooks/useGuardedSubmit.ts`.
 *
 * WHY A REF AND NOT THE `isSubmitting` STATE FLAG
 * -----------------------------------------------
 * Every auth form here already had an `isSubmitting` / `isPending` state flag
 * driving `loading` + `disabled` on its submit button, and every one of them
 * still double-fired. A state flag cannot close the window it is asked to
 * close: `setIsSubmitting(true)` schedules a render, and a second `submit`
 * event dispatched before React commits that render re-enters the handler with
 * the flag still `false`. `disabled` on the button does not help either —
 * implicit form submission (Enter in a field), a synthetic `requestSubmit()`,
 * and a second pointer event queued in the same task all reach the form's
 * `onSubmit` without the button ever being consulted.
 *
 * This is not theoretical. On 2026-09-03 a real user produced three
 * `login_started` events inside 52 ms, burned three of the five attempts the
 * backend login limiter allows per five minutes
 * (`backend/src/middleware/rateLimit.ts`, `loginRateLimit`: 5 FAILED sign-ins
 * / 5 min / IP) and was answered with `RATE_LIMIT` 1.5 s later — locked out of
 * an account whose password they knew.
 *
 * A ref is the fix because the check is SYNCHRONOUS: it rejects the second
 * call in the same tick, before any render could have happened. The state flag
 * stays exactly where it was — it is the VISUAL guard (spinner, disabled
 * styling); the ref is the CORRECTNESS one. Neither replaces the other.
 *
 * WHICH HOOK TO USE
 * -----------------
 * - `useGuardedSubmit` wraps an `async` handler that awaits the request
 *   itself (the auth pages: login, signup, forgot/reset password, resend OTP).
 *   The guard is held for exactly as long as the handler's promise is pending.
 * - `useSubmitGuard` is the manual claim/release form, for handlers built on a
 *   React Query `mutate(...)` callback pair. Those return immediately, so
 *   there is no promise to hold the guard open — the call site claims on entry
 *   and releases in `onSettled`, and pairs the ref with the mutation's own
 *   `isPending` (the ref closes the pre-commit window, `isPending` covers the
 *   rest of the request).
 */

/**
 * True for anything with a callable `preventDefault` — a React synthetic event
 * or a native one. Deliberately structural: the wrapped handlers take
 * `FormEvent<HTMLFormElement>`, a bare string (OAuth provider), or nothing at
 * all, and this must not care which.
 */
function isPreventable(value: unknown): value is { preventDefault: () => void } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'preventDefault' in value &&
    typeof (value as { preventDefault: unknown }).preventDefault === 'function'
  );
}

/**
 * Runs an async submit handler at most once at a time.
 *
 * The returned function is a drop-in replacement for the handler at the
 * `onSubmit` / `onClick` call site — same arguments.
 *
 * IT DOES NOT CATCH, and that is a decision rather than an omission. This doc
 * used to claim the returned promise "always resolves"; it never did — the
 * body below is `try`/`finally` with no `catch`, and this hook's own tests
 * assert `.rejects.toThrow()`. Catching here would make a FAILED submit
 * indistinguishable from a successful one for every caller that awaits the
 * result, and would hide real handler bugs from the error reporter entirely.
 * The guard's single job is re-entrancy.
 *
 * WHAT THAT OBLIGES OF CALL SITES. A site that DISCARDS the returned promise
 * (`onClick={guarded}`, `onClick={() => void guarded(x)}`) turns a rejecting
 * handler into a browser-level unhandled rejection, which
 * `capture_exceptions: true` reports as a context-free `$exception`. Every
 * handler wrapped here today catches its own errors, so nothing rejects — but
 * `ConfirmDialog` accepts an arbitrary caller promise as `onConfirm` and
 * discards it, so THAT shell catches and reports with a boundary. Any future
 * discarding call site owes the same.
 *
 * Two details that are easy to get wrong and are load-bearing here:
 *
 * 1. `preventDefault()` runs BEFORE the guard check, on every call including
 *    the ones the guard rejects. A rejected submit that is not prevented is a
 *    real native form submission — the browser would navigate away from the
 *    page mid-request. Swallowing the event is the whole point; the handlers'
 *    own `event.preventDefault()` calls stay where they are (it is idempotent).
 *
 * 2. The ref is released in a `finally`, so a rejected request, a thrown
 *    handler, or an early `return` out of a validation failure all leave the
 *    form usable. The auth handlers `return` before they set `isSubmitting`
 *    when validation fails — those returns are synchronous, so the release
 *    lands on the very next microtask and the corrected resubmit goes through.
 */
export function useGuardedSubmit<A extends unknown[]>(
  handler: (...args: A) => Promise<unknown> | unknown
): (...args: A) => Promise<void> {
  const inFlight = useRef(false);

  return useCallback(
    async (...args: A): Promise<void> => {
      if (isPreventable(args[0])) args[0].preventDefault();
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        await handler(...args);
      } finally {
        inFlight.current = false;
      }
    },
    [handler]
  );
}

export interface SubmitGuard {
  /** Takes the guard. `false` means a submit is already in flight — bail out. */
  claim: () => boolean;
  /** Releases the guard. Call from the mutation's `onSettled`. */
  release: () => void;
}

/**
 * The manual form of the guard, for handlers that fire a React Query
 * `mutate(...)` and return immediately instead of awaiting it.
 *
 * Pair it with the mutation's `isPending`:
 *
 *   if (mutation.isPending || !guard.claim()) return;
 *   mutation.mutate(input, { onSuccess, onError, onSettled: guard.release });
 *
 * Order matters — `isPending` is checked FIRST so a claim is never taken (and
 * then abandoned) on a call that was going to bail out anyway. Between them
 * the two cover the whole request: the ref rejects re-entry before React has
 * committed the pending render, `isPending` rejects it afterwards.
 *
 * A handler whose success path unmounts the component (navigate away, close
 * the modal) never runs `onSettled` — React Query drops per-call callbacks
 * once the observer is gone. That leaves the ref claimed on a component that
 * no longer exists, which is harmless; every path that stays mounted (an
 * error, or a success that only updates state) does release it.
 */
export function useSubmitGuard(): SubmitGuard {
  const inFlight = useRef(false);

  return useMemo(
    () => ({
      claim: (): boolean => {
        if (inFlight.current) return false;
        inFlight.current = true;
        return true;
      },
      release: (): void => {
        inFlight.current = false;
      },
    }),
    []
  );
}
