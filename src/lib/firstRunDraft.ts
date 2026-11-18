/**
 * First run v2 (1.4.3, docs/mocks-144/first-run-v2/plan.md "Storage"): the answer to
 * "Who are you caring for?" until the account exists and the circle is created.
 *
 * WEB RULE: the recipient's name identifies a person, so it lives IN MEMORY ONLY (this module's
 * variable). Never sessionStorage / localStorage / router state / the URL. A reload, a closed tab or
 * the Apple / Google full-page redirect drops it, and the question is asked again (the plan's web note).
 *
 * The one thing that IS kept in sessionStorage is a BOOLEAN that a first run was started in this tab
 * (`FIRST_RUN_STARTED_KEY`), so a person who came back from the Apple / Google redirect is asked the
 * question again straight away instead of landing on the generic empty state. It carries no name.
 *
 * Mobile twin: store/pendingCircleDraft (memory + SecureStore). Read-and-clear on a successful create.
 */

export interface FirstRunDraft {
  /** Trimmed name, or null for "It's for me". */
  recipientName: string | null;
  isSelfCare: boolean;
  savedAt: number;
  /**
   * Idempotency-Key for the automatic POST /circles, minted WITH the answer (mobile parity:
   * services/firstRunDraft.ts `createKey`), so every retry of this one answer names the same circle.
   */
  createKey: string;
}

export const CREATE_KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

function newCreateKey(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Same as mobile: an answer older than this is stale and dropped on read. */
export const FIRST_RUN_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FIRST_RUN_STARTED_KEY = 'cc.firstRun.started';

let draft: FirstRunDraft | null = null;

export function setFirstRunDraft(
  answer: { recipientName: string; isSelfCare: false } | { recipientName: null; isSelfCare: true },
  now: number = Date.now()
): void {
  const name = answer.isSelfCare ? null : answer.recipientName.trim();
  if (!answer.isSelfCare && !name) return; // an empty or whitespace name is never stored
  // A changed answer is a different circle: it gets a new key.
  draft = { recipientName: name, isSelfCare: answer.isSelfCare, savedAt: now, createKey: newCreateKey() };
  markFirstRunStarted();
}

/** The draft, or null when there is none or it is older than 7 days (then it is also deleted). */
export function peekFirstRunDraft(now: number = Date.now()): FirstRunDraft | null {
  if (draft && now - draft.savedAt > FIRST_RUN_DRAFT_TTL_MS) draft = null;
  return draft;
}

/** Read once and delete (POST /circles succeeded). */
export function takeFirstRunDraft(now: number = Date.now()): FirstRunDraft | null {
  const current = peekFirstRunDraft(now);
  draft = null;
  return current;
}

export function clearFirstRunDraft(): void {
  draft = null;
}

export function markFirstRunStarted(): void {
  try {
    window.sessionStorage.setItem(FIRST_RUN_STARTED_KEY, '1');
  } catch {
    // Storage blocked: the person lands on the empty state instead; nothing is lost.
  }
}

export function isFirstRunStarted(): boolean {
  try {
    return window.sessionStorage.getItem(FIRST_RUN_STARTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Everything about a first run in progress: sign-out, an invite path, a created circle. */
export function clearFirstRun(): void {
  draft = null;
  try {
    window.sessionStorage.removeItem(FIRST_RUN_STARTED_KEY);
  } catch {
    // ignore
  }
}
