import { describe, it, expect } from 'vitest';
import { utf8ByteLength } from '@/lib/utf8ByteLength';

/**
 * Mirrors mobile's `utf8ByteLength` test
 * (`mobile/src/__tests__/screens/auth/passwordSchemaLength.test.ts`) — same
 * cases, both the `TextEncoder` fast path (always present under Node/vitest)
 * and the hand-rolled fallback that ships when an engine has no
 * `TextEncoder`.
 */
describe('utf8ByteLength counts bytes with or without TextEncoder', () => {
  const cases: Array<[string, string, number]> = [
    ['ASCII', 'Password1!', 10],
    ['Latin-1 accents (2 bytes each)', 'contraseña', 11],
    ['CJK (3 bytes each)', '密码', 6],
    ['astral / emoji (4 bytes, one code point, two UTF-16 units)', '🔒', 4],
    ['mixed', 'Aa1!é🔒', 4 + 2 + 4],
    ['empty', '', 0],
  ];

  const withoutTextEncoder = <T,>(fn: () => T): T => {
    const g = globalThis as { TextEncoder?: unknown };
    const saved = g.TextEncoder;
    delete g.TextEncoder;
    try {
      return fn();
    } finally {
      g.TextEncoder = saved;
    }
  };

  it.each(cases)('%s', (_label, input, expected) => {
    // The TextEncoder path (Node, and every real browser).
    expect(typeof globalThis.TextEncoder).toBe('function');
    expect(utf8ByteLength(input)).toBe(expected);

    // The hand-rolled fallback, which is what runs if the engine has none.
    expect(withoutTextEncoder(() => utf8ByteLength(input))).toBe(expected);
  });

  it('agrees with the 72-byte password boundary used by the auth forms', () => {
    const complexPrefix = 'Aa1!';
    // 4 ASCII bytes + 34 two-byte characters = 72 bytes, 38 characters.
    const exactly72Bytes = complexPrefix + 'é'.repeat(34);
    expect(utf8ByteLength(exactly72Bytes)).toBe(72);

    // 72 JS characters, but 140 UTF-8 bytes — the case a character-count cap
    // would wrongly admit.
    const over72Bytes = complexPrefix + 'é'.repeat(68);
    expect(over72Bytes).toHaveLength(72);
    expect(utf8ByteLength(over72Bytes)).toBe(140);
  });
});
