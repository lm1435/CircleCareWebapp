import { createCircle, getCircles, type Circle, type CreateCircleRequest } from '@/api/circles';

/**
 * The automatic first-circle create (first run v2, plan.md "Double taps and retries").
 *
 * It is fired by the app, not a button, so it can run twice: a double mount (StrictMode, a remount
 * on a query refetch), a retry after a timeout whose first request DID land, a second tab. Two
 * guards, client side:
 *
 *  1. ONE IN-FLIGHT PROMISE per page: a second call while the first is pending gets the SAME
 *     promise, so one POST is sent.
 *  2. GET /circles FIRST (kept as a fallback beside the server's idempotent create): an owner who
 *     already has a circle (the earlier request landed) gets that circle back, and nothing is created.
 *  3. The draft's `createKey` as `Idempotency-Key` (backend/src/routes/circles.ts): a second tab or a
 *     retry whose first request landed after the GET still gets the SAME circle from the server.
 */
let inflight: Promise<{ circle: Circle; existed: boolean }> | null = null;

export function createFirstCircleOnce(
  payload: CreateCircleRequest,
  idempotencyKey?: string
): Promise<{ circle: Circle; existed: boolean }> {
  if (inflight) return inflight;
  inflight = (async () => {
    const existing = await getCircles();
    const owned = existing.find((c) => c.role === 'owner');
    if (owned) return { circle: owned, existed: true };
    // 3. The server dedupes too (deployed 1.4.3): the same key returns the same circle.
    const circle = await createCircle(payload, idempotencyKey ? { idempotencyKey } : {});
    return { circle, existed: false };
  })();
  // Released once settled, so a FAILED attempt can be retried ("Try again").
  inflight.then(
    () => {
      inflight = null;
    },
    () => {
      inflight = null;
    }
  );
  return inflight;
}

/** Tests only. */
export function resetFirstCircleCreateForTests(): void {
  inflight = null;
}
