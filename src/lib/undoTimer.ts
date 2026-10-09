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
/**
 * SAFETY CAP. A hold never parks a write forever: a keyboard user's focus lands
 * on Undo right after Take / Done, so a page left open and visible would
 * otherwise never save the dose. However long it is held, the write commits
 * this long after the press (the badge announces it ~10 s before).
 */
export const UNDO_HOLD_CAP_MS = 60_000;

export interface UndoTimer {
  /** Cancel for good (Undo, or a flush that sends the write itself). */
  clear(): void;
  /** `true` pauses the countdown, `false` resumes it with the time left. Idempotent. */
  hold(held: boolean): void;
}

export function startUndoTimer(
  onExpire: () => void,
  ms: number,
  capMs: number = UNDO_HOLD_CAP_MS
): UndoTimer {
  let remaining = ms;
  let startedAt = Date.now();
  let done = false;
  let held = false;
  let id: ReturnType<typeof setTimeout> | null = null;
  let capId: ReturnType<typeof setTimeout> | null = null;

  const fire = (): void => {
    if (done) return;
    done = true;
    if (id !== null) clearTimeout(id);
    if (capId !== null) clearTimeout(capId);
    id = null;
    capId = null;
    onExpire();
  };
  id = setTimeout(fire, remaining);
  // Runs regardless of holds; only ever wins while one is in force.
  capId = setTimeout(fire, Math.max(capMs, ms));

  return {
    clear() {
      done = true;
      if (id !== null) clearTimeout(id);
      if (capId !== null) clearTimeout(capId);
      id = null;
      capId = null;
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
