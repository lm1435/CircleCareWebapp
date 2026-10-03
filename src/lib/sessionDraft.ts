// PK9 (approved-recs-2026-09-30): keep an open form's unsaved draft across a
// FORCED sign-out (the refresh token died mid-session), and nothing else.
//
// Privacy contract (drafts can hold PHI: care notes, vitals, emergency info):
// - sessionStorage ONLY, never localStorage: it dies with the tab.
// - Written ONLY at a forced sign-out (api.ts 401 -> refresh failed). There are
//   no continuous draft writes while the user types.
// - Keyed to the user (`cc:draft:<hash of user id>`), restored ONLY to that same
//   user, within 30 minutes, on the matching form's next mount, then DELETED.
// - Purged on a voluntary sign-out, a cross-tab sign-out, another user signing
//   in, and expiry. Tab close drops it by itself.

const PREFIX = 'cc:draft:';
export const DRAFT_TTL_MS = 30 * 60 * 1000;

interface StoredDrafts {
  savedAt: number;
  drafts: Record<string, unknown>;
}

type Getter = () => unknown | null;

const registry = new Map<string, Getter>();
let forcedPending = false;

/** FNV-1a: the raw user id never appears in a storage key. */
function hashUser(userId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function draftKeys(s: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

/** A mounted form announces its draft. Returns the unregister function. */
export function registerDraft(key: string, getValue: Getter): () => void {
  registry.set(key, getValue);
  return () => {
    if (registry.get(key) === getValue) registry.delete(key);
  };
}

/**
 * FORCED sign-out only: serialize every registered, non-empty draft for this
 * user, and mark the coming teardown as forced so `onSessionEnded` keeps it.
 */
export function saveDraftsForForcedSignOut(userId: string | null | undefined): void {
  forcedPending = true;
  const s = storage();
  if (!s || !userId) return;
  const drafts: Record<string, unknown> = {};
  for (const [key, get] of registry) {
    try {
      const value = get();
      if (value !== null && value !== undefined) drafts[key] = value;
    } catch {
      // a broken getter must never block the sign-out
    }
  }
  try {
    if (Object.keys(drafts).length === 0) return;
    const payload: StoredDrafts = { savedAt: Date.now(), drafts };
    s.setItem(PREFIX + hashUser(userId), JSON.stringify(payload));
  } catch {
    // quota / disabled storage: the draft is simply lost, as before
  }
}

/**
 * Called by every local teardown. A forced one keeps the saved entry; any
 * other (explicit sign-out, another tab's sign-out) purges everything.
 */
export function onSessionEnded(): void {
  const forced = forcedPending;
  forcedPending = false;
  if (forced) return;
  purgeAllDrafts();
}

export function purgeAllDrafts(): void {
  const s = storage();
  if (!s) return;
  try {
    for (const k of draftKeys(s)) s.removeItem(k);
  } catch {
    // ignore
  }
}

/** Sign-in / bootstrap: drop every entry that is not this user's or is stale. */
export function reconcileDrafts(userId: string): void {
  const s = storage();
  if (!s) return;
  const mine = PREFIX + hashUser(userId);
  try {
    for (const k of draftKeys(s)) {
      if (k !== mine) {
        s.removeItem(k);
        continue;
      }
      const parsed = parse(s.getItem(k));
      if (!parsed || Date.now() - parsed.savedAt >= DRAFT_TTL_MS) s.removeItem(k);
    }
  } catch {
    // ignore
  }
}

function parse(raw: string | null): StoredDrafts | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as StoredDrafts;
    if (typeof v?.savedAt !== 'number' || !v.drafts || typeof v.drafts !== 'object') return null;
    return v;
  } catch {
    return null;
  }
}

/** Restore side: consume (read + delete) this user's saved draft for `key`. */
export function takeDraft<T>(userId: string | null | undefined, key: string): T | null {
  const s = storage();
  if (!s || !userId) return null;
  reconcileDrafts(userId);
  const storageKey = PREFIX + hashUser(userId);
  try {
    const parsed = parse(s.getItem(storageKey));
    if (!parsed || !(key in parsed.drafts)) return null;
    const value = parsed.drafts[key] as T;
    delete parsed.drafts[key];
    if (Object.keys(parsed.drafts).length === 0) s.removeItem(storageKey);
    else s.setItem(storageKey, JSON.stringify(parsed));
    return value;
  } catch {
    return null;
  }
}
