import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearAllDraftRequestIds,
  clearDraftRequestId,
  requestIdForDraft,
} from '@/lib/noteRequestId';

// N-W1: the held id is cleared only by the save that used it.
describe('clearDraftRequestId(scope, id)', () => {
  beforeEach(() => clearAllDraftRequestIds());

  it('POSITIVE: clears when the held id matches (the next note in the scope is new)', () => {
    const id = requestIdForDraft('s', 'text');
    clearDraftRequestId('s', id);
    expect(requestIdForDraft('s', 'text')).not.toBe(id);
  });

  it('NEGATIVE: a different id (a slow earlier save) leaves the newer draft id in place', () => {
    const older = requestIdForDraft('s', 'old text');
    const newer = requestIdForDraft('s', 'new text'); // the draft changed: a new id replaced it
    expect(newer).not.toBe(older);
    clearDraftRequestId('s', older);
    expect(requestIdForDraft('s', 'new text')).toBe(newer);
  });

  it('NEGATIVE: another scope is never touched', () => {
    const a = requestIdForDraft('a', 't');
    const b = requestIdForDraft('b', 't');
    clearDraftRequestId('a', a);
    expect(requestIdForDraft('b', 't')).toBe(b);
  });

  it('without an id it still clears the scope (back-compat for existing callers)', () => {
    const id = requestIdForDraft('s', 't');
    clearDraftRequestId('s');
    expect(requestIdForDraft('s', 't')).not.toBe(id);
  });
});
