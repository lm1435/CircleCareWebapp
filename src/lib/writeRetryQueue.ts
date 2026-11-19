import { Analytics } from '@/lib/analytics';
import { classifyFailureCode } from '@/lib/apiErrors';
import { isOfflineNow } from '@/hooks/useIsOffline';
import { clearAllDraftRequestIds } from '@/lib/noteRequestId';
import { isOfflineWriteRejection } from '@/lib/offlineWrite';

/**
 * ONE QUIET RETRY for a quick save that dies on a network drop (1.4.3, plan
 * docs/plans/purchase-trial-gaps-1-4-3.md item 7). Web twin of mobile's
 * `services/writeRetryQueue.ts`.
 *
 * Production, 2026-11-18: ~30 quick completions, the link stalled for 25 s, then
 * 11 failed at once with 11 stacked error dialogs and the user redid them by
 * hand. Now a TRANSPORT failure (timeout / network_error, nothing definite from
 * the server) is retried quietly and the user sees ONE aggregated notice
 * ("Couldn't save N updates" with Retry) only if it never lands.
 *
 * RULES
 *  - Only `isRetryableTransportFailure` is retried. A 4xx / backend code (403
 *    VIEW_ONLY, 404, 409, 402 ...) is a real refusal: it goes to `onRefused`
 *    (today's per-surface copy), never back into the queue.
 *  - One entry per key (`${kind}:${itemKey}`). A later intent for the same item
 *    SUPERSEDES: `cancel(key)` / a new `enqueue` bump the key's `seq`, and the
 *    runner re-checks `seq === latestSeq[key]` before EVERY send, so the latest
 *    intent wins and a stale retry never fires.
 *  - One in-flight send per key: a re-tap or a resume can never double-send.
 *  - A MAX AGE from the tap (`MAX_AGE_MS`): a write is never resent hours later.
 *  - `landed()` is asked before every resend (task completion is not idempotent
 *    on old backends): when the lost-response attempt DID land, nothing is sent
 *    again. A server `replayed: true` is success like any other.
 *  - Backoff 2, 5, 10, 20, 40 s. Resume (tab visible again, browser online)
 *    runs every waiting entry at once, 3 at a time.
 *  - Offline browser: nothing is sent while `isOfflineNow()` (owner decision
 *    2026-10-14: no writes while offline, lib/offlineWrite.ts). The tap itself is
 *    refused offline by the UI, so an entry only exists for a connection that
 *    dropped AFTER the tap; its retries simply wait for the `online` event.
 *  - Payloads are in memory only, by design: a reload refetches the truth and nothing is
 *    replayed under another session. `clear()` runs on every sign-out. What IS persisted
 *    (localStorage, 1.4.3 audit item 13) is the kind and tap time of each outstanding entry,
 *    never a payload or an id, so a reload that dropped a pending save still shows ONE
 *    "Couldn't save N updates" notice (`hydrateWriteRetryQueue`), as mobile does.
 */

export type WriteRetryKind =
  | 'task_complete'
  | 'as_needed_dose'
  | 'event_note'
  | 'care_note'
  | 'inbox_read'
  | 'medication_confirm';

export type WriteRetryVia = 'backoff' | 'resume' | 'online' | 'manual';

export interface WriteRetryEntry {
  /** `${kind}:${itemKey}`, unique per item. */
  key: string;
  kind: WriteRetryKind;
  /** The circle the TAP was made in (never the one on screen at resend time). */
  circleId: string;
  /** One attempt. Resolves on success (a `replayed: true` answer is success). */
  send: () => Promise<unknown>;
  /** Re-read before a resend: true when the earlier attempt already landed. */
  landed?: () => Promise<boolean>;
  /** The write is on the server (sent, replayed, or found landed). */
  onSettled?: (via: WriteRetryVia | 'landed', result?: unknown) => void;
  /** A definite refusal came back (not retryable): report it as today. */
  onRefused?: (error: unknown) => void;
  /** Gave up: refetch so rows show the truth. The aggregated notice follows. */
  onGaveUp?: () => void;
}

interface Queued {
  /** Persistence row id (random, never a domain id). */
  uid: string;
  entry: WriteRetryEntry;
  seq: number;
  tapAt: number;
  attempts: number;
  nextAt: number;
  via: WriteRetryVia;
}

/** Backoff steps; beyond the ladder the last step repeats until the max age. */
export const WRITE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 40_000] as const;
/** From the tap. After this the entry is given up on, never resent. */
export const WRITE_RETRY_MAX_AGE_MS = 5 * 60_000;
const CONCURRENCY = 3;

/** Only a transport failure is retried: nothing reached (or came back from) the server. */
export function isRetryableTransportFailure(error: unknown): boolean {
  const code = classifyFailureCode(error);
  return code === 'timeout' || code === 'network_error';
}

/**
 * Queue callers (task complete, as-needed dose) treat a write the client backstop refused
 * because the browser went offline JUST AFTER the tap (code OFFLINE, nothing was sent) like a
 * transport failure: the entry waits for the `online` event. Not used by `sendWithQuietRetry`.
 */
export function isQueueableFailure(error: unknown): boolean {
  return isRetryableTransportFailure(error) || isOfflineWriteRejection(error);
}

const queued = new Map<string, Queued>();
/** Given-up entries keep their ORIGINAL tap time, so Retry can refuse hours-old writes. */
const failed = new Map<string, { uid: string; entry: WriteRetryEntry; tapAt: number }>();
/** A given-up write is offered for Retry only this long after the tap. */
export const FAILED_WRITE_MAX_AGE_MS = 10 * 60_000;
/** Bumped by sign-out: a foreground retry sleeping across it must not resend. */
let sessionEpoch = 0;
const latestSeq = new Map<string, number>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let seqCounter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let draining = false;
let listening = false;

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Analytics / a caller callback must never break a save.
  }
}

function pruneStaleFailed(): void {
  const now = Date.now();
  failed.forEach((f, key) => {
    if (now - f.tapAt > FAILED_WRITE_MAX_AGE_MS) failed.delete(key);
  });
}

// ── persistence (kind + tap time only: no ids, no content) ───────────────────────────────────────
/** localStorage; one object keyed by tab, so two open tabs never overwrite each other. */
export const WRITE_RETRY_STORAGE_KEY = 'circlecare:writeRetryOutstanding';
/** sessionStorage: survives a reload of THIS tab (the case we surface), not a new tab. */
const WRITE_RETRY_TAB_KEY = 'circlecare:writeRetryTab';
interface PersistedRow {
  k: string;
  t: number;
  u: string;
}
/** Saves lost to a reload, read back once: counted in the notice, never resendable. */
let orphanCount = 0;
let uidCounter = 0;

function newUid(): string {
  uidCounter += 1;
  return `${Date.now().toString(36)}-${uidCounter}`;
}

function tabId(): string {
  try {
    let id = sessionStorage.getItem(WRITE_RETRY_TAB_KEY);
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(WRITE_RETRY_TAB_KEY, id);
    }
    return id;
  } catch {
    return 'tab';
  }
}

function readStore(): Record<string, PersistedRow[]> {
  try {
    const raw = localStorage.getItem(WRITE_RETRY_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, PersistedRow[]>)
      : {};
  } catch {
    return {};
  }
}

function persist(): void {
  try {
    const rows: PersistedRow[] = [];
    queued.forEach((q) => rows.push({ k: q.entry.kind, t: q.tapAt, u: q.uid }));
    failed.forEach((f) => rows.push({ k: f.entry.kind, t: f.tapAt, u: f.uid }));
    for (let i = 0; i < orphanCount; i += 1) rows.push({ k: 'orphan', t: 0, u: `orphan-${i}` });
    const store = readStore();
    const me = tabId();
    // Other tabs' rows past the failed max age can never be shown again: drop them.
    const now = Date.now();
    Object.keys(store).forEach((tab) => {
      if (tab !== me && !(store[tab] ?? []).some((r) => now - r.t <= FAILED_WRITE_MAX_AGE_MS)) {
        delete store[tab];
      }
    });
    if (rows.length === 0) delete store[me];
    else store[me] = rows;
    if (Object.keys(store).length === 0) localStorage.removeItem(WRITE_RETRY_STORAGE_KEY);
    else localStorage.setItem(WRITE_RETRY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage blocked / full: the in-memory queue still works.
  }
}

/**
 * Call once at app start (the notice host does). Rows this tab left on disk before a RELOAD
 * belong to saves whose payload is gone: the person is TOLD once instead of finding a missing
 * task later. Rows older than the failed max age are dropped (the server stamps its own clock).
 */
export function hydrateWriteRetryQueue(): void {
  try {
    const mine = readStore()[tabId()];
    if (!Array.isArray(mine)) return;
    const live = new Set<string>();
    queued.forEach((q) => live.add(q.uid));
    failed.forEach((f) => live.add(f.uid));
    const now = Date.now();
    const lost = mine.filter(
      (r) =>
        r &&
        typeof r.u === 'string' &&
        !live.has(r.u) &&
        (r.k === 'orphan' || (typeof r.t === 'number' && now - r.t <= FAILED_WRITE_MAX_AGE_MS))
    ).length;
    if (lost > 0) {
      orphanCount = lost;
      persist();
      notify();
    } else {
      persist();
    }
  } catch {
    // Never break boot.
  }
}

function notify(): void {
  pruneStaleFailed();
  persist();
  listeners.forEach((l) => safe(l));
}

/** useSyncExternalStore plumbing for the notice host. */
export function subscribeWriteRetry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Given-up writes still worth a Retry (older than the failed max age are excluded). */
export function getFailedCount(): number {
  const now = Date.now();
  let count = 0;
  failed.forEach((f) => {
    if (now - f.tapAt <= FAILED_WRITE_MAX_AGE_MS) count += 1;
  });
  return count;
}

/** What the ONE notice counts: given-up writes in this tab plus saves lost to a reload. */
export function getNoticeCount(): number {
  return getFailedCount() + orphanCount;
}

/** Entries waiting for a retry (not counting ones that gave up). */
export function pendingCount(): number {
  return queued.size;
}

/** True while an entry for this key is waiting or in flight. */
export function hasWriteRetry(key: string): boolean {
  return queued.has(key) || inFlight.has(key);
}

function ensureListeners(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void drain(true, 'resume');
  });
  window.addEventListener('online', () => void drain(true, 'online'));
}

function schedule(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (queued.size === 0) return;
  let next = Infinity;
  if (isOfflineNow()) {
    // Offline nothing is sent and the `online` listener drains, so NO retry timer
    // (it would spin at 0 ms). One timer for the earliest max-age expiry only, so
    // an over-age entry still gives up and the notice shows.
    queued.forEach((q) => {
      if (!inFlight.has(q.entry.key)) next = Math.min(next, q.tapAt + WRITE_RETRY_MAX_AGE_MS + 1);
    });
    if (next === Infinity) return;
    timer = setTimeout(
      () => {
        timer = null;
        void drain(false, 'backoff');
      },
      Math.max(1_000, next - Date.now())
    );
    return;
  }
  queued.forEach((q) => {
    if (!inFlight.has(q.entry.key)) next = Math.min(next, q.nextAt);
  });
  if (next === Infinity) return;
  timer = setTimeout(
    () => {
      timer = null;
      void drain(false, 'backoff');
    },
    Math.max(0, next - Date.now())
  );
}

/**
 * Queue a write whose FIRST attempt just failed with a transport failure. The
 * first retry is due after the first backoff step. A previous entry for the same
 * key is superseded.
 */
export function enqueueWriteRetry(entry: WriteRetryEntry, opts: { tapAt?: number } = {}): void {
  ensureListeners();
  const seq = ++seqCounter;
  latestSeq.set(entry.key, seq);
  failed.delete(entry.key);
  const now = Date.now();
  queued.set(entry.key, {
    uid: newUid(),
    entry,
    seq,
    tapAt: opts.tapAt ?? now,
    attempts: 0,
    nextAt: now + WRITE_RETRY_DELAYS_MS[0],
    via: 'backoff',
  });
  notify();
  safe(() => Analytics.writeRetryScheduled(entry.kind, queued.size));
  schedule();
}

/**
 * A later intent for the same item wins (the user took it back): nothing queued
 * is sent. Returns true when there was an entry. An attempt already in flight
 * cannot be recalled: if it lands, the write stands (the server has no
 * un-complete), which the caller's refetch then shows.
 */
export function cancelWriteRetry(key: string): boolean {
  const had = queued.has(key);
  latestSeq.set(key, ++seqCounter);
  queued.delete(key);
  const hadFailed = failed.delete(key);
  if (had || hadFailed) notify();
  schedule();
  return had;
}

function giveUp(q: Queued): void {
  queued.delete(q.entry.key);
  failed.set(q.entry.key, { uid: q.uid, entry: q.entry, tapAt: q.tapAt });
  safe(() => Analytics.writeRetryGaveUp(q.entry.kind, failed.size));
  safe(() => q.entry.onGaveUp?.());
  notify();
}

function isCurrent(q: Queued): boolean {
  return latestSeq.get(q.entry.key) === q.seq && queued.get(q.entry.key) === q;
}

async function attempt(q: Queued): Promise<void> {
  const { entry } = q;
  if (!isCurrent(q)) return;
  if (Date.now() - q.tapAt > WRITE_RETRY_MAX_AGE_MS) {
    giveUp(q);
    return;
  }
  inFlight.add(entry.key);
  try {
    let landedAlready = false;
    let result: unknown;
    if (entry.landed) {
      try {
        landedAlready = await entry.landed();
      } catch {
        landedAlready = false;
      }
    }
    // The re-read took time: the user may have taken the write back meanwhile.
    if (!isCurrent(q)) return;
    if (!landedAlready) result = await entry.send();
    inFlight.delete(entry.key);
    if (queued.get(entry.key) === q) queued.delete(entry.key);
    safe(() => Analytics.writeRetrySucceeded(entry.kind, 1, q.via));
    safe(() => entry.onSettled?.(landedAlready ? 'landed' : q.via, result));
    notify();
  } catch (error) {
    inFlight.delete(entry.key);
    if (!isCurrent(q)) return;
    if (!isQueueableFailure(error)) {
      // A real refusal (403 / 404 / 409 / 402 ...): never retried, today's copy.
      queued.delete(entry.key);
      safe(() => entry.onRefused?.(error));
      notify();
      return;
    }
    q.attempts += 1;
    if (Date.now() - q.tapAt > WRITE_RETRY_MAX_AGE_MS) {
      giveUp(q);
      return;
    }
    const step = WRITE_RETRY_DELAYS_MS[Math.min(q.attempts, WRITE_RETRY_DELAYS_MS.length - 1)];
    q.nextAt = Date.now() + step;
    q.via = 'backoff';
  } finally {
    inFlight.delete(entry.key);
  }
}

/** Run what is due (or everything waiting, on a resume), 3 at a time. */
async function drain(force: boolean, via: WriteRetryVia): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const now = Date.now();
      // Over-age entries give up BEFORE the offline return, so the notice shows.
      [...queued.values()].forEach((q) => {
        if (!inFlight.has(q.entry.key) && isCurrent(q) && now - q.tapAt > WRITE_RETRY_MAX_AGE_MS) {
          giveUp(q);
        }
      });
      const due = [...queued.values()].filter(
        (q) => !inFlight.has(q.entry.key) && (force || q.nextAt <= now)
      );
      if (due.length === 0) return;
      for (let i = 0; i < due.length; i += CONCURRENCY) {
        // Nothing is sent while the browser is offline: wait for `online`.
        if (isOfflineNow()) return;
        const batch = due.slice(i, i + CONCURRENCY);
        batch.forEach((q) => {
          q.via = force ? via : 'backoff';
        });
        await Promise.all(batch.map((q) => attempt(q)));
      }
      // A forced pass tries each waiting entry once; the timer owns the rest.
      if (force) return;
    }
  } finally {
    draining = false;
    schedule();
  }
}

/**
 * FOREGROUND QUIET RETRY, for a write whose caller is still waiting on it (the
 * note composers). Same rules as the queue (transport failures only, a max age,
 * one in-flight run per key, a 4xx / backend code is rethrown at once), but the
 * caller's promise stays pending across the backoff, so a draft is NEVER cleared
 * for a save that has not landed: the composer keeps its text and its own inline
 * error if every attempt fails, which is why no aggregated notice is needed.
 *
 * `send` MUST carry an idempotency key (`client_request_id`): a first attempt
 * whose response was lost may have landed, and the server then answers the
 * resend 200 `replayed: true`, which resolves here like any success.
 */
/**
 * Thrown when the session ended (sign-out / account switch) while a foreground write was waiting to
 * retry. The caches were already cleared with the session, so a mutation's `onError` must NOT run its
 * optimistic rollback (it would write the old rows back into the next account's cache).
 */
export class SessionEndedError extends Error {
  constructor() {
    super('Write cancelled: session ended');
    this.name = 'SessionEndedError';
  }
}

const foregroundInFlight = new Set<string>();
export const FOREGROUND_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

export async function sendWithQuietRetry<T>(
  key: string,
  kind: WriteRetryKind,
  send: () => Promise<T>,
  opts: { delaysMs?: readonly number[]; maxAgeMs?: number } = {}
): Promise<T> {
  // One in-flight run per key: a re-submit of the same request joins nothing, it is refused.
  if (foregroundInFlight.has(key)) throw new Error('Write already in flight');
  foregroundInFlight.add(key);
  const delays = opts.delaysMs ?? FOREGROUND_RETRY_DELAYS_MS;
  const maxAge = opts.maxAgeMs ?? WRITE_RETRY_MAX_AGE_MS;
  const startedAt = Date.now();
  const epoch = sessionEpoch;
  let retries = 0;
  try {
    for (;;) {
      try {
        const result = await send();
        if (retries > 0) safe(() => Analytics.writeRetrySucceeded(kind, 1, 'backoff'));
        return result;
      } catch (error) {
        const delay = delays[retries];
        if (
          !isRetryableTransportFailure(error) ||
          delay === undefined ||
          Date.now() - startedAt + delay > maxAge
        ) {
          if (retries > 0 && isRetryableTransportFailure(error)) {
            safe(() => Analytics.writeRetryGaveUp(kind, 1));
          }
          throw error;
        }
        if (retries === 0) safe(() => Analytics.writeRetryScheduled(kind, 1));
        retries += 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
        // Signed out meanwhile: never resend under another session. Offline: no
        // writes (owner decision 2026-10-14); the composer keeps its draft and error.
        // Both exits are a give-up after at least one retry: report it like the max-age exit does.
        if (epoch !== sessionEpoch) {
          safe(() => Analytics.writeRetryGaveUp(kind, 1));
          throw new SessionEndedError();
        }
        if (isOfflineNow()) {
          safe(() => Analytics.writeRetryGaveUp(kind, 1));
          throw error;
        }
      }
    }
  } finally {
    foregroundInFlight.delete(key);
  }
}

/** The notice's Retry: every given-up entry goes again with a fresh budget. */
export function retryFailedWrites(): void {
  pruneStaleFailed(); // hours-old writes are never resent
  const entries = [...failed.values()].map((f) => f.entry);
  failed.clear();
  if (entries.length === 0) {
    notify();
    return;
  }
  const now = Date.now();
  entries.forEach((entry) => {
    const seq = ++seqCounter;
    latestSeq.set(entry.key, seq);
    queued.set(entry.key, {
      uid: newUid(),
      entry,
      seq,
      tapAt: now,
      attempts: 0,
      nextAt: now,
      via: 'manual',
    });
  });
  notify();
  void drain(true, 'manual');
}

/** The notice was dismissed: forget what gave up (rows were already refetched). */
export function dismissFailedWrites(): void {
  if (failed.size === 0 && orphanCount === 0) return;
  failed.clear();
  orphanCount = 0;
  notify();
}

/** Sign-out / account switch: nothing queued under the old session is ever sent. */
export function clearWriteRetryQueue(): void {
  sessionEpoch += 1;
  clearAllDraftRequestIds();
  queued.forEach((_q, key) => latestSeq.set(key, ++seqCounter));
  queued.clear();
  failed.clear();
  orphanCount = 0;
  // Sign-out wipes every tab's persisted rows: nothing outstanding survives the session.
  try {
    localStorage.removeItem(WRITE_RETRY_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was persisted either.
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  notify();
}

/** Test hook: full reset including in-flight bookkeeping. */
export function __resetWriteRetryForTests(): void {
  clearWriteRetryQueue();
  orphanCount = 0;
  uidCounter = 0;
  inFlight.clear();
  foregroundInFlight.clear();
  latestSeq.clear();
  listeners.clear();
  draining = false;
  seqCounter = 0;
}
