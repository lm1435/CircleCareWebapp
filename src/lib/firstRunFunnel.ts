import {
  Analytics,
  type FirstRunDurationBucket,
  type FirstRunFunnelStep,
  type FirstRunPath,
} from '@/lib/analytics';

/**
 * First run v2 funnel (1.4.3, plan.md "Funnel: where people stall"). Four events through the
 * existing Analytics service, enums only:
 *
 *   first_run_step_viewed     once per step per run
 *   first_run_step_completed  when the step's forward action SUCCEEDED, with a duration bucket
 *   first_run_back_tapped     the step's Back
 *   first_run_abandoned       the tab was hidden for 30 s (or closed) mid-run; once per step
 *
 * Web abandon rule: `visibilitychange` -> hidden starts a 30 s timer, visible again cancels it (the
 * trip to the inbox for the code). `pagehide` without bfcache (the tab is closing) cannot wait 30 s,
 * so it sends at once. Never after `today` was viewed. The last step an abandon was sent for is kept
 * in memory and in localStorage, so a repeat for the same step is skipped.
 */

export const ABANDON_DELAY_MS = 30_000;
export const ABANDON_STEP_KEY = 'cc.firstRun.abandonedStep';
const PATH_KEY = 'cc.firstRun.path';

interface RunState {
  viewed: Set<FirstRunFunnelStep>;
  viewedAt: Map<FirstRunFunnelStep, number>;
  completed: Set<FirstRunFunnelStep>;
  lastStep: FirstRunFunnelStep | null;
  finished: boolean;
}

/** Analytics is best-effort: a funnel event must never cost the person the step it measures. */
function safely(send: () => void): void {
  try {
    send();
  } catch {
    // ignore
  }
}

function freshRun(): RunState {
  return { viewed: new Set(), viewedAt: new Map(), completed: new Set(), lastStep: null, finished: false };
}

let run: RunState = freshRun();
let abandonTimer: ReturnType<typeof setTimeout> | null = null;
let lastAbandonedStep: FirstRunFunnelStep | null = null;
let listening = false;

export function durationBucket(ms: number): FirstRunDurationBucket {
  if (ms < 10_000) return 'under_10s';
  if (ms < 30_000) return '10_to_30s';
  if (ms < 60_000) return '30_to_60s';
  if (ms < 180_000) return '1_to_3m';
  return 'over_3m';
}

export function getFirstRunPath(): FirstRunPath {
  try {
    const stored = window.sessionStorage.getItem(PATH_KEY);
    if (stored === 'apple' || stored === 'google' || stored === 'invited') return stored;
  } catch {
    // ignore
  }
  return 'email';
}

export function setFirstRunPath(path: FirstRunPath): void {
  try {
    window.sessionStorage.setItem(PATH_KEY, path);
  } catch {
    // ignore
  }
}

function readAbandoned(): FirstRunFunnelStep | null {
  if (lastAbandonedStep) return lastAbandonedStep;
  try {
    return (window.localStorage.getItem(ABANDON_STEP_KEY) as FirstRunFunnelStep | null) ?? null;
  } catch {
    return null;
  }
}

function sendAbandon(): void {
  abandonTimer = null;
  const step = run.lastStep;
  if (!step || run.finished) return;
  if (readAbandoned() === step) return;
  lastAbandonedStep = step;
  try {
    window.localStorage.setItem(ABANDON_STEP_KEY, step);
  } catch {
    // ignore
  }
  safely(() => Analytics.firstRunAbandoned(step));
}

function cancelAbandon(): void {
  if (abandonTimer) clearTimeout(abandonTimer);
  abandonTimer = null;
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    if (!run.lastStep || run.finished || abandonTimer) return;
    abandonTimer = setTimeout(sendAbandon, ABANDON_DELAY_MS);
  } else {
    cancelAbandon();
  }
}

function onPageHide(event: Event): void {
  // A bfcache'd page may come back; leave that to the visibility timer.
  if ((event as PageTransitionEvent).persisted) return;
  cancelAbandon();
  sendAbandon();
}

function listen(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
}

export const firstRunFunnel = {
  /** The step finished appearing. Once per step per run. */
  viewed(step: FirstRunFunnelStep, circleId?: string): void {
    if (run.finished) return;
    listen();
    run.lastStep = step;
    if (run.viewed.has(step)) return;
    run.viewed.add(step);
    run.viewedAt.set(step, Date.now());
    safely(() => Analytics.firstRunStepViewed(circleId, step, getFirstRunPath()));
    if (step === 'today') {
      run.finished = true;
      cancelAbandon();
    }
  },
  /** The step's forward action succeeded. Once per step per run. */
  completed(step: FirstRunFunnelStep, circleId?: string): void {
    if (run.finished || run.completed.has(step)) return;
    run.completed.add(step);
    const since = run.viewedAt.get(step);
    safely(() =>
      Analytics.firstRunStepCompleted(
        step,
        durationBucket(since === undefined ? 0 : Date.now() - since),
        getFirstRunPath(),
        circleId
      )
    );
  },
  back(step: FirstRunFunnelStep): void {
    if (run.finished) return;
    safely(() => Analytics.firstRunBackTapped(step));
  },
  /** True once any step was viewed in this run and Today was not reached yet. */
  isActive(): boolean {
    return run.lastStep !== null && !run.finished;
  },
};

/** Tests only: a fresh run and no listeners' state. */
export function resetFirstRunFunnelForTests(): void {
  cancelAbandon();
  run = freshRun();
  lastAbandonedStep = null;
  try {
    window.localStorage.removeItem(ABANDON_STEP_KEY);
    window.sessionStorage.removeItem(PATH_KEY);
  } catch {
    // ignore
  }
}
