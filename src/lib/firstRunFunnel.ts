import {
  Analytics,
  type FirstRunDurationBucket,
  type FirstRunFailReason,
  type FirstRunFunnelStep,
  type FirstRunPath,
} from '@/lib/analytics';
import { classifyFailureCode, isNoResponseFailure } from '@/lib/apiErrors';

/**
 * First run v2 funnel (1.4.3, plan.md "Funnel: where people stall"). Five events through the
 * existing Analytics service, enums only:
 *
 *   first_run_step_viewed     once per step per run
 *   first_run_step_completed  when the step's forward action SUCCEEDED, with a duration bucket
 *   first_run_step_failed     a REQUIRED step's forward action failed, with a closed `reason`
 *                             (owner 2026-11-22); once per failed attempt, never on success
 *   first_run_step_skipped    the OPTIONAL step (first item) was left unsaved; once per run, never
 *                             after it completed (mobile parity)
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
  skipped: Set<FirstRunFunnelStep>;
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
  return {
    viewed: new Set(),
    viewedAt: new Map(),
    completed: new Set(),
    skipped: new Set(),
    lastStep: null,
    finished: false,
  };
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

const RATE_LIMIT_CODES = new Set([
  'RATE_LIMIT',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
  'AUTH_RATE_LIMITED',
  'EMAIL_RATE_LIMIT',
  'EMAIL_QUOTA_EXCEEDED',
  'http_429',
]);
const INVALID_CODE_CODES = new Set([
  'VERIFICATION_FAILED',
  'INVALID_CODE',
  'INVALID_CODE_OR_EMAIL',
  'INVALID_TOKEN',
  'INVITE_NOT_FOUND',
]);
/** The invite exists but cannot be used any more (spent, circle gone, recipient seat taken). */
const INVITE_INVALID_CODES = new Set([
  'INVITE_ALREADY_USED',
  'INVITE_NOT_PENDING',
  'CIRCLE_ARCHIVED',
  'CARE_RECIPIENT_EXISTS',
  'CARE_RECIPIENT_INVITE_PENDING',
  'EMAIL_MISMATCH',
]);
const SERVER_CODES = new Set(['SERVER_ERROR', 'non_json_response', 'api_error_no_code', 'AUTH_UNAVAILABLE']);

/**
 * A failed forward action -> `first_run_step_failed.reason`. Reads only the error's CODE (the backend's
 * constant, `http_<status>` or the transport class), never its message, so nothing typed can leak.
 */
export function firstRunFailReason(err: unknown): FirstRunFailReason {
  try {
    if (isNoResponseFailure(err)) return 'network';
    const code = classifyFailureCode(err);
    if (code === 'OFFLINE' || code === 'network_error' || code === 'timeout') return 'network';
    if (RATE_LIMIT_CODES.has(code)) return 'rate_limited';
    if (code === 'USER_EXISTS') return 'already_exists';
    if (code === 'INVITE_EXPIRED') return 'expired_code';
    if (INVALID_CODE_CODES.has(code)) return 'invalid_code';
    if (INVITE_INVALID_CODES.has(code)) return 'invite_invalid';
    if (code === 'SUBSCRIPTION_REQUIRED' || code === 'http_402') return 'seat_full';
    if (code === 'VALIDATION_ERROR' || code === 'http_400' || code === 'http_422') return 'validation';
    if (SERVER_CODES.has(code) || /^http_5\d\d$/.test(code)) return 'server';
    return 'unknown';
  } catch {
    return 'unknown';
  }
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
  /**
   * A REQUIRED step's forward action failed. Once per failed attempt (each refused tap is a signal);
   * never after Today. Call it from the failure branch only, never on the tap.
   */
  failed(step: FirstRunFunnelStep, reason: FirstRunFailReason): void {
    if (run.finished) return;
    safely(() => Analytics.firstRunStepFailed(step, reason, getFirstRunPath()));
  },
  /** The optional step was left unsaved (Skip for now, x, Escape). Once per run; never once completed. */
  skipped(step: FirstRunFunnelStep): void {
    if (run.finished || run.completed.has(step) || run.skipped.has(step)) return;
    run.skipped.add(step);
    safely(() => Analytics.firstRunStepSkipped(step, getFirstRunPath()));
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
