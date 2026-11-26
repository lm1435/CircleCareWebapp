import { scopedKey } from '@/lib/storageScope';

// Persistence for Today's coaching elements (docs/plans/simple-ui-1-3-1.md,
// "Coaching"). Same mechanism the web already uses for similar UI state
// (the retired Home help card and Getting Started checklist): localStorage, namespaced by the
// signed-in user through `scopedKey`, every read and write inside try/catch
// (storage throws in private mode / when blocked; the card then lasts for the
// page view only). Non-sensitive UI preference, never a secret.

/** "Not now" on the next-step card hides the CURRENT step for 3 days. */
export const NEXT_STEP_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 1.4.4: step 1 ("first_med") is done once the circle has ANY first item setup lets an owner start with:
 * a medication, an appointment or a task (what the presence read reports). Same rule as mobile's
 * utils/nextStep. An empty circle keeps step 1.
 */
export type FirstItemKind = 'medication' | 'appointment' | 'task';

export function firstItemKind(
  presence: { medication?: boolean; appointment?: boolean; task?: boolean } | null | undefined
): FirstItemKind | null {
  if (!presence) return null;
  if (presence.medication === true) return 'medication';
  if (presence.appointment === true) return 'appointment';
  if (presence.task === true) return 'task';
  return null;
}

export type NextStepKey = 'first_med' | 'invite' | 'reminders';

const NEXT_STEP_BASE = 'today_next_step_snoozed';
const DOSE_HINT_BASE = 'today_dose_hint_seen';
const SHIFTS_NUDGE_BASE = 'today_shifts_nudge_dismissed';
const SHIFTS_NUDGE_COUNT_BASE = 'today_shifts_nudge_shown';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: dismissal lasts for this page view only.
  }
}

type SnoozeMap = Partial<Record<NextStepKey, number>>;

function snoozeKey(circleId: string): string {
  return scopedKey(`${NEXT_STEP_BASE}:${circleId}`);
}

function readSnoozes(circleId: string): SnoozeMap {
  const raw = read(snoozeKey(circleId));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' ? (parsed as SnoozeMap) : {};
  } catch {
    return {};
  }
}

/** True while `step` is inside its 3-day "Not now" window. */
export function isNextStepSnoozed(circleId: string, step: NextStepKey, now = Date.now()): boolean {
  const at = readSnoozes(circleId)[step];
  return typeof at === 'number' && now - at < NEXT_STEP_SNOOZE_MS && now >= at;
}

export function snoozeNextStep(circleId: string, step: NextStepKey, now = Date.now()): void {
  write(snoozeKey(circleId), JSON.stringify({ ...readSnoozes(circleId), [step]: now }));
}

/** First-dose hint: shown once per signed-in user, ever. */
export function hasSeenDoseHint(): boolean {
  return read(scopedKey(DOSE_HINT_BASE)) === 'true';
}

export function markDoseHintSeen(): void {
  write(scopedKey(DOSE_HINT_BASE), 'true');
}

/**
 * Shifts nudge: at most 3 showings per user per circle in total (1.4.2; it was shown 174 times to
 * 70 people and acted on 3 times), and never again after "Set up shifts" / "Not now". A showing =
 * one Today visit where the card renders. localStorage, same as the dismissal.
 */
export const SHIFTS_NUDGE_MAX_SHOWINGS = 3;

function shiftsNudgeCountKey(circleId: string): string {
  return scopedKey(`${SHIFTS_NUDGE_COUNT_BASE}:${circleId}`);
}

/** How many times the card has been shown to this user in this circle (0 when unknown). */
export function getShiftsNudgeShowCount(circleId: string): number {
  const n = Number.parseInt(read(shiftsNudgeCountKey(circleId)) ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, SHIFTS_NUDGE_MAX_SHOWINGS) : 0;
}

/** Counts one showing; returns its 1-based ordinal (the `show_count` property). */
export function recordShiftsNudgeShowing(circleId: string): number {
  const next = Math.min(getShiftsNudgeShowCount(circleId) + 1, SHIFTS_NUDGE_MAX_SHOWINGS);
  write(shiftsNudgeCountKey(circleId), String(next));
  return next;
}

/** Shifts nudge: once per user per circle. */
export function hasDismissedShiftsNudge(circleId: string): boolean {
  return read(scopedKey(`${SHIFTS_NUDGE_BASE}:${circleId}`)) === 'true';
}

export function dismissShiftsNudge(circleId: string): void {
  write(scopedKey(`${SHIFTS_NUDGE_BASE}:${circleId}`), 'true');
}

// ── Role-aware next steps + the helper's card (1.4.4) ───────────────────────
// Same rules as mobile's utils/nextStep.ts and utils/helperCard.ts. The next-step card is the OWNER's
// setup checklist; a plain helper (not the owner, a manager or the care recipient) gets ONE calm,
// dismissible card instead. Dismissal: localStorage, per user (scopedKey) AND circle.

export type NextStepViewerRole = 'owner' | 'manager' | 'recipient' | 'helper';

export function nextStepViewerRole(v: {
  isOwner: boolean;
  isRecipient: boolean;
  canManageMembers: boolean;
}): NextStepViewerRole {
  if (v.isOwner) return 'owner';
  if (v.isRecipient) return 'recipient';
  if (v.canManageMembers) return 'manager';
  return 'helper';
}

/**
 * Steps this role can do (identical to mobile's applicableSteps; the invite step still needs the invite right,
 * checked by the caller): owner and recipient all three (the recipient's copy is first person, and a recipient
 * with manage rights is offered the invite step like on mobile); a manager invite + reminders ("add the first
 * medication" is setup that belongs to the owner and the recipient); a helper none.
 */
export function applicableNextSteps(role: NextStepViewerRole, order: readonly NextStepKey[]): NextStepKey[] {
  return order.filter((s) => {
    if (role === 'helper') return false;
    if (s === 'first_med') return role === 'owner' || role === 'recipient';
    return true;
  });
}

/** 'note' = "Leave a note"; 'care_team' = "See the care team" (view-only: no write action is offered). */
export type HelperCardAction = 'note' | 'care_team';

export function helperCardAction(canWrite: boolean): HelperCardAction {
  return canWrite ? 'note' : 'care_team';
}

const HELPER_CARD_BASE = 'today_helper_card_dismissed';

export function hasDismissedHelperCard(circleId: string): boolean {
  return read(scopedKey(`${HELPER_CARD_BASE}:${circleId}`)) === 'true';
}

export function dismissHelperCard(circleId: string): void {
  write(scopedKey(`${HELPER_CARD_BASE}:${circleId}`), 'true');
}

/**
 * Which body line the helper card shows (identical to mobile's helperCardBody). It must never be false:
 *  'busy'  Next up has anything for the viewer: "Here is what is coming up for {name} today."
 *  The card is NOT rendered in a circle that uses shifts (circle.has_shifts): Overview loads no shift list, so
 *  "Nothing needs you right now" could be false for a helper on shift (pages/OverviewPage).
 *  'quiet' Next up is empty: "Nothing needs you right now." The web has no push, so it never adds
 *          "You'll hear from us when something does" (mobile adds it only when push is granted).
 */
export type HelperCardBody = 'busy' | 'quiet';

export function helperCardBody(nextUpCount: number): HelperCardBody {
  return nextUpCount > 0 ? 'busy' : 'quiet';
}
