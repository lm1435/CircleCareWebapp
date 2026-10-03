import { REFETCH_CAP_MS, withRefetchCap } from '@/lib/refetchCap';

// Shared by useTaskCompletion.ts and useMedConfirmation.ts — a pending/undo UI
// state must never wait forever on a refetch that `networkMode: 'online'`
// leaves paused offline. See refetchCap.ts's own doc comment for the incident
// this closes on each caller's side.

describe('withRefetchCap', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves once the wrapped promise resolves, well ahead of the cap', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    let done = false;
    void withRefetchCap(promise).then(() => {
      done = true;
    });

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
  });

  // PAIRED with the next test: this is the "one ms before the cap" half — a
  // promise that never settles must still be pending at REFETCH_CAP_MS - 1.
  it('does NOT resolve one ms before the cap when the promise never settles', async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    let done = false;
    void withRefetchCap(never).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(REFETCH_CAP_MS - 1);
    expect(done).toBe(false);
  });

  // PAIRED with the previous test: the same never-settling promise resolves
  // at exactly the cap.
  it('resolves at the cap when the promise never settles', async () => {
    vi.useFakeTimers();
    const never = new Promise<void>(() => {});
    let done = false;
    void withRefetchCap(never).then(() => {
      done = true;
    });

    await vi.advanceTimersByTimeAsync(1); // 1ms short of the cap...
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(REFETCH_CAP_MS - 1); // ...the rest lands on it.
    expect(done).toBe(true);
  });

  it('clears its cap timer once the wrapped promise wins the race', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });

    const capped = withRefetchCap(promise);
    release();
    await capped;

    expect(clearSpy).toHaveBeenCalled();
  });

  it('clears its cap timer once the cap itself wins the race (never leaves a stray timer running)', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(global, 'clearTimeout');
    const never = new Promise<void>(() => {});

    const capped = withRefetchCap(never);
    await vi.advanceTimersByTimeAsync(REFETCH_CAP_MS);
    await capped;

    expect(clearSpy).toHaveBeenCalled();
  });

  // NEVER REJECTS — a failed refetch must release a pending UI state exactly
  // like a slow one hitting the cap, never throw past this call.
  it('resolves (does not reject) when the wrapped promise rejects', async () => {
    const rejected = Promise.reject(new Error('refetch failed'));
    await expect(withRefetchCap(rejected)).resolves.toBeUndefined();
  });
});
