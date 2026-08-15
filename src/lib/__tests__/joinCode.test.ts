import { extractJoinCode, isCompleteJoinCode, normalizeJoinCode } from '../joinCode';

// R4-2 — join-code normalization helpers. Pure functions, exhaustively
// unit-tested here; the form (JoinCircleModal) wires them to the input,
// submit gating, and the clipboard-assist button.

describe('normalizeJoinCode', () => {
  it('uppercases lowercase input', () => {
    expect(normalizeJoinCode('abc123')).toBe('ABC123');
  });

  it('strips spaces and dashes (type and paste formats)', () => {
    expect(normalizeJoinCode('abc-123')).toBe('ABC123');
    expect(normalizeJoinCode('ab c 123')).toBe('ABC123');
    expect(normalizeJoinCode(' AB-C 1-23 ')).toBe('ABC123');
  });

  it('strips all whitespace kinds (tabs, newlines from email copies)', () => {
    expect(normalizeJoinCode('ABC\t1\n23')).toBe('ABC123');
  });

  it('keeps unexpected characters visible instead of silently dropping them', () => {
    expect(normalizeJoinCode('abc!23')).toBe('ABC!23');
  });

  it('returns empty string for empty/whitespace-only input', () => {
    expect(normalizeJoinCode('')).toBe('');
    expect(normalizeJoinCode('  - ')).toBe('');
  });
});

describe('isCompleteJoinCode', () => {
  it('is true at exactly 6 characters', () => {
    expect(isCompleteJoinCode('ABC123')).toBe(true);
  });

  it('is false below and above 6 characters', () => {
    expect(isCompleteJoinCode('')).toBe(false);
    expect(isCompleteJoinCode('ABC12')).toBe(false);
    expect(isCompleteJoinCode('ABC1234')).toBe(false);
  });

  // WB10 REGRESSION — length alone used to gate submit; a 6-char string with
  // a stray non-alphanumeric character (a common mis-paste from an email)
  // enabled Submit and only failed after a round trip to the backend. Old
  // code: these all returned true.
  it('is false when a stray non-alphanumeric character survives normalization', () => {
    expect(isCompleteJoinCode('ABC12!')).toBe(false);
    expect(isCompleteJoinCode('ABC-12')).toBe(false);
    expect(isCompleteJoinCode('AB C12')).toBe(false);
  });

  it('is false for un-normalized (lowercase) input — callers must normalize first', () => {
    expect(isCompleteJoinCode('abc123')).toBe(false);
  });
});

describe('extractJoinCode', () => {
  it('extracts a clean 6-char alphanumeric code', () => {
    expect(extractJoinCode('ABC123')).toBe('ABC123');
  });

  it('normalizes formatting before matching (case, spaces, dashes)', () => {
    expect(extractJoinCode('ab c-123')).toBe('ABC123');
    expect(extractJoinCode('AB-CD-EF')).toBe('ABCDEF');
  });

  it('rejects clipboard text that is not exactly a code', () => {
    expect(extractJoinCode('Your code is ABC123')).toBeNull();
    expect(extractJoinCode('https://example.com/invite/ABC123')).toBeNull();
    expect(extractJoinCode('ABC12')).toBeNull();
    expect(extractJoinCode('ABC1234')).toBeNull();
    expect(extractJoinCode('ABC!23')).toBeNull();
    expect(extractJoinCode('')).toBeNull();
  });
});
