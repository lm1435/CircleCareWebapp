// Shared by every mutation that holds a pending/undo UI state open until a
// post-write refetch lands (src/hooks/useTaskCompletion.ts,
// src/hooks/useMedConfirmation.ts) — the timeout half of that wait, factored
// out so both surfaces cap it identically instead of drifting.

/**
 * How long `withRefetchCap` will wait for a refetch before giving up and
 * resolving anyway.
 *
 * WHY THE CAP EXISTS. Every `QueryClient` in this app runs with `networkMode:
 * 'online'` (src/lib/queryClient.ts): a refetch attempted while the browser is
 * offline is PAUSED rather than rejected, and a paused fetch's promise does
 * not settle until connectivity returns. Without a cap, a caregiver whose
 * connection drops between a write succeeding and its refetch landing would
 * be left with a row stuck in its pending/undo state forever. Past the cap,
 * the behavior is exactly what shipped before the caller waited on a refetch
 * at all: the pending state clears, and the (possibly still-stale) cached data
 * renders until the refetch — still running in the background — eventually
 * lands.
 */
export const REFETCH_CAP_MS = 4000;

/**
 * Resolve when `promise` settles, or after `capMs`, whichever comes first.
 *
 * NEVER REJECTS. A rejected `promise` resolves this too — every caller only
 * ever needs "stop waiting now", not "why", and a failed refetch must release
 * a pending UI state exactly like a slow one hitting the cap, never throw past
 * this call and leave that state stuck.
 *
 * The cap timer is ALWAYS cleared, including when `promise` wins the race — a
 * stray timer per call would keep the event loop awake for nothing (and holds
 * Vitest's process open in tests using real timers). Losing the race does NOT
 * cancel `promise` — whatever it is waiting on keeps running and still updates
 * the cache; the caller simply stops waiting on it.
 */
export function withRefetchCap(promise: Promise<unknown>, capMs: number = REFETCH_CAP_MS): Promise<void> {
  let capTimer: ReturnType<typeof setTimeout>;
  const capped = new Promise<void>((resolve) => {
    capTimer = setTimeout(resolve, capMs);
  });
  // `.then(noop, noop)` rather than `.then(noop).catch(noop)` — a rejection
  // must resolve THIS promise, not just be swallowed downstream of it.
  const settleFromPromise = promise.then(
    () => undefined,
    () => undefined
  );
  return Promise.race([settleFromPromise, capped]).finally(() => clearTimeout(capTimer));
}
