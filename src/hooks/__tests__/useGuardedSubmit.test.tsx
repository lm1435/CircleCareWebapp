import { renderHook, render, screen } from '@testing-library/react';
import type { FormEvent, ReactElement } from 'react';
import { useGuardedSubmit, useSubmitGuard } from '@/hooks/useGuardedSubmit';
import { neverSettles, submitFormTwice } from '@/test/doubleSubmit';

// The hook itself had no test of its own. Every property below is load-bearing,
// and each one survived being deleted while the ten suites that USE the hook
// stayed green — a guard nothing pins is a guard that will be "simplified".

describe('useGuardedSubmit — the rejected call is still prevented', () => {
  /**
   * A form whose submit handler never settles, so the guard is still held when
   * the second submit arrives. That second call is the one under test.
   */
  function Harness({ handler }: { handler: (event: FormEvent) => unknown }): ReactElement {
    const onSubmit = useGuardedSubmit(handler);
    return (
      <form data-testid="guarded-form" onSubmit={onSubmit}>
        <input name="email" defaultValue="pat@example.com" />
        <input name="password" type="password" defaultValue="Secret#123" />
        <button type="submit">Sign in</button>
      </form>
    );
  }

  function guardedForm(): HTMLFormElement {
    return screen.getByTestId('guarded-form') as HTMLFormElement;
  }

  // `preventDefault()` runs BEFORE the ref check, on EVERY call including the
  // ones the guard rejects. Reordering those two lines leaves every existing
  // suite green, and ships this: the rejected submit is not prevented, so the
  // browser performs a real native submission. `LoginPage`'s form is
  // `<form onSubmit={...} noValidate>` with `name="email"` / `name="password"`
  // and NO `action`/`method`, which means a default GET to the current URL —
  // the user's password lands in the address bar, in browser history, and in
  // the `Referer` header of every subsequent request, while the page navigates
  // away mid-login.
  //
  // `dispatchEvent` returns false exactly when a listener called
  // `preventDefault()`, so this is directly observable; it is the only thing
  // that distinguishes the two orderings.
  it('calls preventDefault on BOTH submits, not just the one it runs', async () => {
    const handler = vi.fn(() => neverSettles());
    render(<Harness handler={handler} />);

    const prevented = await submitFormTwice(guardedForm());

    // Anchored: the guard did its job (one call) AND both events were swallowed.
    expect(handler).toHaveBeenCalledTimes(1);
    expect(prevented).toEqual([true, true]);
  });

  it('prevents a submit it rejects even when the handler is synchronous', async () => {
    // A handler that returns immediately still holds the guard for the rest of
    // the tick, so the second submit of a same-tick pair is rejected — and it
    // must be swallowed on that path too.
    const handler = vi.fn();
    render(<Harness handler={handler} />);

    const prevented = await submitFormTwice(guardedForm());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(prevented).toEqual([true, true]);
  });
});

describe('useGuardedSubmit — the guard is released in a finally', () => {
  // Deleting the `try`/`finally` leaves every existing suite green, because no
  // suite has a handler that THROWS: the auth pages all catch their own errors.
  // Without it the ref stays claimed forever and the form is dead for the rest
  // of its life — one thrown handler and the user cannot submit again without
  // reloading the page.
  it('a THROWING handler does not latch the guard shut', async () => {
    const handler = vi.fn(() => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useGuardedSubmit(handler));

    await expect(result.current()).rejects.toThrow('boom');
    // The second call must reach the handler — this is the assertion that a
    // released-only-on-success guard fails.
    await expect(result.current()).rejects.toThrow('boom');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('a REJECTING async handler does not latch the guard shut', async () => {
    const handler = vi.fn(() => Promise.reject(new Error('500')));
    const { result } = renderHook(() => useGuardedSubmit(handler));

    await expect(result.current()).rejects.toThrow('500');
    await expect(result.current()).rejects.toThrow('500');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('holds the guard for exactly as long as the handler is pending', async () => {
    const handler = vi.fn(() => neverSettles());
    const { result } = renderHook(() => useGuardedSubmit(handler));

    void result.current();
    // Not a same-tick pair: several microtasks later, the request is still in
    // flight and the guard must still refuse.
    await Promise.resolve();
    await Promise.resolve();
    void result.current();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('tolerates a first argument that is not an event', async () => {
    // The OAuth call sites pass a bare provider string; `isPreventable` is
    // structural precisely so this is not a crash.
    const handler = vi.fn((provider: string) => Promise.resolve(provider));
    const { result } = renderHook(() => useGuardedSubmit(handler));

    await result.current('google');

    expect(handler).toHaveBeenCalledWith('google');
  });
});

describe('useSubmitGuard — claim/release', () => {
  it('refuses a second claim until the first is released', () => {
    const { result } = renderHook(() => useSubmitGuard());

    expect(result.current.claim()).toBe(true);
    expect(result.current.claim()).toBe(false);

    result.current.release();
    expect(result.current.claim()).toBe(true);
  });

  it('is stable across re-renders — a new object each render would guard nothing', () => {
    const { result, rerender } = renderHook(() => useSubmitGuard());
    const first = result.current;

    rerender();

    expect(result.current).toBe(first);
    // And the claim taken before the re-render is still held.
    expect(first.claim()).toBe(true);
    expect(result.current.claim()).toBe(false);
  });
});
