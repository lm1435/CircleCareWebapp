/**
 * The commit timer behind every undo badge (dose marks, task completion,
 * as-needed doses) — a `setTimeout` that can be HELD.
 *
 * WCAG 2.2.1 Timing Adjustable (owner decision 2026-10-08). A website cannot
 * tell whether a screen reader is running, so instead of mobile's longer
 * window the countdown PAUSES while the pointer is over the badge or keyboard
 * focus is inside it, and RESUMES with the time that was left once both have
 * gone. The write commits only when the timer actually runs out — or when a
 * flush (unmount, `pagehide`, the page going hidden) sends it early, which
 * `clear()` + the caller's own send already cover. The 5 s base is unchanged.
 */
export interface UndoTimer {
  /** Cancel for good (Undo, or a flush that sends the write itself). */
  clear(): void;
  /** `true` pauses the countdown, `false` resumes it with the time left. Idempotent. */
  hold(held: boolean): void;
}

export function startUndoTimer(onExpire: () => void, ms: number): UndoTimer {
  let remaining = ms;
  let startedAt = Date.now();
  let done = false;
  let held = false;
  let id: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    if (done) return;
    done = true;
    id = null;
    onExpire();
  };
  id = setTimeout(fire, remaining);

  return {
    clear() {
      done = true;
      if (id !== null) clearTimeout(id);
      id = null;
    },
    hold(next) {
      if (done || next === held) return;
      held = next;
      if (held) {
        if (id !== null) clearTimeout(id);
        id = null;
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
      } else {
        startedAt = Date.now();
        id = setTimeout(fire, remaining);
      }
    },
  };
}
