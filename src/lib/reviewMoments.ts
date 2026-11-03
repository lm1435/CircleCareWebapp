/**
 * WHEN THE WEB ASKS AN APP USER TO RATE CIRCLECARE (pricing report 2026-11,
 * owner-approved). Web port of mobile's services/storeReview.ts +
 * services/reviewSignals.ts, for the one thing web can do: show the gentle,
 * dismissible StoreReviewBanner (a link to the App Store / Play listing). The
 * browser has no OS review sheet.
 *
 * The banner used to appear on any visit 3 days after an app device was first
 * seen. Now it waits for one of the SAME four moments as mobile:
 *
 *   member_joined  the first person this owner invited joined their circle
 *   doses_week     this user has marked doses on 7 different days (this browser)
 *   shift_covered  this user took a care shift
 *   alert_handled  this user opened a "not marked yet" inbox alert and answered the dose
 *
 * and then only once the user has paused for QUIET_MS (never mid-batch), with
 * no failure in the last ERROR_QUIET_MS and no paywall shown in this tab's
 * session. The banner's own snooze / dismissal cap / "rated" state still apply
 * (components/StoreReviewBanner.tsx).
 *
 * Enums and counts only leave this module (Analytics). The member baseline is
 * kept by circle id in localStorage, which never leaves the browser.
 */

export type ReviewTrigger = 'member_joined' | 'doses_week' | 'shift_covered' | 'alert_handled';

export const QUIET_MS = 8000;
export const ERROR_QUIET_MS = 10 * 60 * 1000;
const ALERT_HANDLED_WINDOW_MS = 30 * 60 * 1000;
const DOSE_DAYS_FOR_WEEK = 7;
const MAX_DOSE_DAYS_KEPT = 14;

export const DOSE_DAYS_KEY = 'cc_review_dose_days';
export const MEMBER_BASELINE_KEY = 'cc_review_member_baseline';
/** sessionStorage: a paywall was on screen in this tab's session. */
export const PAYWALL_SESSION_KEY = 'cc_review_paywall_session';

let pendingTrigger: ReviewTrigger | null = null;
let readyTrigger: ReviewTrigger | null = null;
let quietTimer: ReturnType<typeof setTimeout> | null = null;
let lastErrorAt = 0;
let paywallThisSession = false;
const alertOpenedAt = new Map<string, number>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // A listener must never break the caller.
    }
  });
}

function readSession(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function paywallSeen(): boolean {
  return paywallThisSession || readSession(PAYWALL_SESSION_KEY);
}

function armQuietTimer(): void {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = setTimeout(() => {
    quietTimer = null;
    const trigger = pendingTrigger;
    pendingTrigger = null;
    if (!trigger) return;
    if (paywallSeen()) return;
    if (lastErrorAt && Date.now() - lastErrorAt < ERROR_QUIET_MS) return;
    if (readyTrigger) return;
    readyTrigger = trigger;
    emit();
  }, QUIET_MS);
}

/** A good moment happened. The banner may show once the user has paused. */
export function raiseReviewMoment(trigger: ReviewTrigger): void {
  if (readyTrigger || paywallSeen()) return;
  if (!pendingTrigger) pendingTrigger = trigger;
  armQuietTimer();
}

/** The user is in the middle of something: a pending ask waits. */
export function noteReviewActivity(): void {
  if (pendingTrigger) armQuietTimer();
}

/** Something failed in front of the user: no ask for ERROR_QUIET_MS. */
export function noteReviewBlockingError(): void {
  lastErrorAt = Date.now();
  noteReviewActivity();
}

/** A paywall or upgrade ask is on screen: no ask for the rest of this tab's session. */
export function notePaywallShown(): void {
  paywallThisSession = true;
  pendingTrigger = null;
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = null;
  try {
    window.sessionStorage.setItem(PAYWALL_SESSION_KEY, '1');
  } catch {
    // The in-memory flag still holds for this page.
  }
  if (readyTrigger) {
    readyTrigger = null;
    emit();
  }
}

/** A "not marked yet" alert for this circle was opened (inbox row). */
export function noteAlertOpened(circleId: string | null | undefined): void {
  if (circleId) alertOpenedAt.set(circleId, Date.now());
}

/** The browser's own calendar day, YYYY-MM-DD. */
function localDay(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * A dose in this circle was answered. Any answer is activity; a TAKEN dose
 * counts toward the week of dose days; an answer after opening that circle's
 * alert is "alert handled".
 */
export function noteDoseAnswered(circleId: string | null | undefined, status: string): void {
  noteReviewActivity();
  if (circleId) {
    const openedAt = alertOpenedAt.get(circleId);
    if (openedAt !== undefined) {
      alertOpenedAt.delete(circleId);
      if (Date.now() - openedAt <= ALERT_HANDLED_WINDOW_MS) raiseReviewMoment('alert_handled');
    }
  }
  if (status !== 'taken') return;
  try {
    const raw = window.localStorage.getItem(DOSE_DAYS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const days = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    const today = localDay(new Date());
    if (days.includes(today)) return;
    const next = [...days, today].slice(-MAX_DOSE_DAYS_KEPT);
    window.localStorage.setItem(DOSE_DAYS_KEY, JSON.stringify(next));
    if (new Set(next).size >= DOSE_DAYS_FOR_WEEK) raiseReviewMoment('doses_week');
  } catch {
    // Storage blocked: no week moment from this browser.
  }
}

/**
 * Watch the owner's circles for the FIRST person joining. A circle seen for the
 * first time only records its baseline, so nobody is asked on page load; the
 * moment is a circle going from just the owner to someone else too.
 */
export function observeCircleMembers(
  circles: readonly { id: string; role?: string | null; member_count?: number | null }[] | undefined
): void {
  if (!circles || circles.length === 0) return;
  try {
    const raw = window.localStorage.getItem(MEMBER_BASELINE_KEY);
    let baseline: Record<string, number> = {};
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === 'object') baseline = parsed as Record<string, number>;
    } catch {
      baseline = {};
    }
    let joined = false;
    const next: Record<string, number> = {};
    for (const c of circles) {
      if (c.role !== 'owner' || typeof c.member_count !== 'number') continue;
      const before = baseline[c.id];
      if (typeof before === 'number' && before <= 1 && c.member_count >= 2) joined = true;
      next[c.id] = c.member_count;
    }
    window.localStorage.setItem(MEMBER_BASELINE_KEY, JSON.stringify(next));
    if (joined) raiseReviewMoment('member_joined');
  } catch {
    // Storage blocked: no member moment from this browser.
  }
}

/** The moment the banner may show for, or null. */
export function getReadyReviewTrigger(): ReviewTrigger | null {
  return readyTrigger;
}

/** The banner was resolved (rated / dismissed): the moment is spent. */
export function consumeReviewMoment(): void {
  if (!readyTrigger) return;
  readyTrigger = null;
  emit();
}

export function subscribeReviewMoments(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: a fresh page. */
export function __resetReviewMomentsForTests(): void {
  if (quietTimer) clearTimeout(quietTimer);
  quietTimer = null;
  pendingTrigger = null;
  readyTrigger = null;
  lastErrorAt = 0;
  paywallThisSession = false;
  alertOpenedAt.clear();
  try {
    window.sessionStorage.removeItem(PAYWALL_SESSION_KEY);
  } catch {
    // ignore
  }
}
