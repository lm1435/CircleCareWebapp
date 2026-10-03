import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_TTL_MS,
  onSessionEnded,
  purgeAllDrafts,
  reconcileDrafts,
  registerDraft,
  saveDraftsForForcedSignOut,
  takeDraft,
} from '../sessionDraft';

const entries = (): string[] =>
  Object.keys(sessionStorage).filter((k) => k.startsWith('cc:draft:'));

describe('sessionDraft (PK9)', () => {
  let unregister: Array<() => void> = [];
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    onSessionEnded(); // clears the forced flag + purges
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
  });
  afterEach(() => {
    unregister.forEach((u) => u());
    unregister = [];
    vi.useRealTimers();
  });

  const reg = (key: string, value: unknown): void => {
    unregister.push(registerDraft(key, () => value));
  };

  it('forced sign-out saves to sessionStorage only, keyed by a hash (not the raw id)', () => {
    reg('notes:create:c1', { body: 'private note' });
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded(); // the forced teardown
    expect(entries()).toHaveLength(1);
    expect(entries()[0]).not.toContain('user-1');
    expect(localStorage.length).toBe(0);
  });

  it('restores to the same user within 30 minutes, once, then deletes it', () => {
    reg('k', { body: 'x' });
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded();
    vi.advanceTimersByTime(DRAFT_TTL_MS - 1000);
    expect(takeDraft('user-1', 'k')).toEqual({ body: 'x' });
    expect(entries()).toHaveLength(0);
    expect(takeDraft('user-1', 'k')).toBeNull();
  });

  it('does not restore to a different user and deletes the entry', () => {
    reg('k', { body: 'x' });
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded();
    expect(takeDraft('user-2', 'k')).toBeNull();
    expect(entries()).toHaveLength(0);
    expect(takeDraft('user-1', 'k')).toBeNull();
  });

  it('reconcile on sign-in drops another user entry without any form mounting', () => {
    reg('k', { body: 'x' });
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded();
    reconcileDrafts('user-2');
    expect(entries()).toHaveLength(0);
  });

  it('expires after 30 minutes and is deleted', () => {
    reg('k', { body: 'x' });
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded();
    vi.advanceTimersByTime(DRAFT_TTL_MS + 1);
    expect(takeDraft('user-1', 'k')).toBeNull();
    expect(entries()).toHaveLength(0);
  });

  it('a voluntary (non-forced) teardown purges a previously saved entry', () => {
    reg('k', { body: 'x' });
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded(); // forced: kept
    expect(entries()).toHaveLength(1);
    onSessionEnded(); // next teardown is not forced: purge
    expect(entries()).toHaveLength(0);
  });

  it('writes nothing without a forced sign-out and skips empty (null) drafts', () => {
    reg('empty', null);
    reg('full', { a: 1 });
    expect(entries()).toHaveLength(0);
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded();
    expect(takeDraft('user-1', 'empty')).toBeNull();
    expect(takeDraft('user-1', 'full')).toEqual({ a: 1 });
  });

  it('only forms still mounted (registered) are saved', () => {
    const off = registerDraft('gone', () => ({ a: 1 }));
    off();
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded();
    expect(entries()).toHaveLength(0);
  });

  it('purgeAllDrafts clears every entry', () => {
    reg('k', { a: 1 });
    saveDraftsForForcedSignOut('user-1');
    onSessionEnded();
    purgeAllDrafts();
    expect(entries()).toHaveLength(0);
  });
});
