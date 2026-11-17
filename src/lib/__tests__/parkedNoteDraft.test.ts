// BH-024 parked care-note draft: memory only, same user + same circle, within DRAFT_TTL_MS, at
// most once. Twin of mobile src/__tests__/utils/parkedNoteDraft.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearParkedNoteDrafts,
  parkNoteDraft,
  takeParkedNoteDraft,
} from '@/lib/parkedNoteDraft';
import { DRAFT_TTL_MS } from '@/lib/sessionDraft';

const DRAFT = { body: 'Skipped dinner', mood: null, categories: [], noteDate: null };

describe('parkedNoteDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
    clearParkedNoteDrafts();
  });
  afterEach(() => vi.useRealTimers());

  it('P: restored for the same user and circle within the TTL', () => {
    parkNoteDraft('c1', 'u1', DRAFT);
    vi.advanceTimersByTime(DRAFT_TTL_MS - 1000);
    expect(takeParkedNoteDraft('c1', 'u1')).toEqual(DRAFT);
  });

  it('N: restored at most once', () => {
    parkNoteDraft('c1', 'u1', DRAFT);
    expect(takeParkedNoteDraft('c1', 'u1')).toEqual(DRAFT);
    expect(takeParkedNoteDraft('c1', 'u1')).toBeNull();
  });

  it('N: not restored after the TTL, and the expired copy is gone', () => {
    parkNoteDraft('c1', 'u1', DRAFT);
    vi.advanceTimersByTime(DRAFT_TTL_MS + 1);
    expect(takeParkedNoteDraft('c1', 'u1')).toBeNull();
    vi.setSystemTime(new Date('2026-11-17T15:00:00Z'));
    expect(takeParkedNoteDraft('c1', 'u1')).toBeNull();
  });

  it('N: not restored after a sign-out (clearParkedNoteDrafts)', () => {
    parkNoteDraft('c1', 'u1', DRAFT);
    parkNoteDraft('c2', 'u1', DRAFT);
    clearParkedNoteDrafts();
    expect(takeParkedNoteDraft('c1', 'u1')).toBeNull();
    expect(takeParkedNoteDraft('c2', 'u1')).toBeNull();
  });

  it('N: not restored into another circle', () => {
    parkNoteDraft('c1', 'u1', DRAFT);
    expect(takeParkedNoteDraft('c2', 'u1')).toBeNull();
    expect(takeParkedNoteDraft('c1', 'u1')).toEqual(DRAFT);
  });

  it('N: not restored for another user, and that attempt deletes it', () => {
    parkNoteDraft('c1', 'u1', DRAFT);
    expect(takeParkedNoteDraft('c1', 'u2')).toBeNull();
    expect(takeParkedNoteDraft('c1', 'u1')).toBeNull();
  });

  it('N: not restored when nobody is signed in', () => {
    parkNoteDraft('c1', 'u1', DRAFT);
    expect(takeParkedNoteDraft('c1', undefined)).toBeNull();
  });

  it('N: parking with no signed-in user stores nothing', () => {
    parkNoteDraft('c1', null, DRAFT);
    parkNoteDraft('c1', undefined, DRAFT);
    expect(takeParkedNoteDraft('c1', 'u1')).toBeNull();
  });
});
