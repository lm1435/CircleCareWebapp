import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CREATE_KEY_RE,
  FIRST_RUN_DRAFT_TTL_MS,
  clearFirstRun,
  isFirstRunStarted,
  peekFirstRunDraft,
  setFirstRunDraft,
  takeFirstRunDraft,
} from '../firstRunDraft';

// First run v2 (1.4.3), plan.md "Storage": the recipient's name lives IN MEMORY only on web.

beforeEach(() => {
  clearFirstRun();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('firstRunDraft', () => {
  it('POSITIVE: a name is kept (trimmed) and read once on take', () => {
    setFirstRunDraft({ recipientName: '  Rosa ', isSelfCare: false });
    expect(peekFirstRunDraft()).toMatchObject({ recipientName: 'Rosa', isSelfCare: false });
    expect(takeFirstRunDraft()).toMatchObject({ recipientName: 'Rosa' });
    expect(peekFirstRunDraft()).toBeNull();
  });

  it('POSITIVE: each answer mints a valid Idempotency-Key (16-128 of [A-Za-z0-9_-]); a new answer gets a new key', () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    const first = peekFirstRunDraft()!.createKey;
    expect(first).toMatch(CREATE_KEY_RE);
    setFirstRunDraft({ recipientName: 'Ana', isSelfCare: false });
    expect(peekFirstRunDraft()!.createKey).not.toBe(first);
  });

  it('POSITIVE: "It\'s for me" stores self-care with no name', () => {
    setFirstRunDraft({ recipientName: null, isSelfCare: true });
    expect(peekFirstRunDraft()).toMatchObject({ recipientName: null, isSelfCare: true });
  });

  it('NEGATIVE: an empty or whitespace-only name is never stored', () => {
    setFirstRunDraft({ recipientName: '', isSelfCare: false });
    expect(peekFirstRunDraft()).toBeNull();
    setFirstRunDraft({ recipientName: '   ', isSelfCare: false });
    expect(peekFirstRunDraft()).toBeNull();
  });

  it('NEGATIVE: the name never reaches sessionStorage or localStorage (only a boolean marker)', () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    const dump = JSON.stringify({ ...window.sessionStorage }) + JSON.stringify({ ...window.localStorage });
    expect(dump).not.toContain('Rosa');
    expect(isFirstRunStarted()).toBe(true);
  });

  it('NEGATIVE: an answer older than 7 days is dropped on read', () => {
    const t0 = 1_000_000;
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false }, t0);
    expect(peekFirstRunDraft(t0 + FIRST_RUN_DRAFT_TTL_MS)).not.toBeNull();
    expect(peekFirstRunDraft(t0 + FIRST_RUN_DRAFT_TTL_MS + 1)).toBeNull();
    // ...and stays gone.
    expect(peekFirstRunDraft(t0)).toBeNull();
  });

  it('NEGATIVE: clearFirstRun drops the name and the started marker', () => {
    setFirstRunDraft({ recipientName: 'Rosa', isSelfCare: false });
    clearFirstRun();
    expect(peekFirstRunDraft()).toBeNull();
    expect(isFirstRunStarted()).toBe(false);
  });

  it('NEGATIVE: sign-out clears it (authStore local teardown calls clearFirstRun) - source guard', () => {
    const src = readFileSync(join(__dirname, '../../store/authStore.ts'), 'utf8');
    const teardown = src.slice(src.indexOf('function clearLocalSession'));
    expect(teardown.slice(0, 3000)).toContain('clearFirstRun();');
  });
});
