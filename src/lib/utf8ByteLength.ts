/**
 * UTF-8 byte length of a string.
 *
 * THE SERVER'S PASSWORD CAP IS COUNTED IN BYTES, NOT JS CHARACTERS. GoTrue
 * rejects anything over 72 with `400 "Password cannot be longer than 72
 * characters"` — the limit is bcrypt's, and bcrypt counts BYTES. So
 * `'Aa1!' + 'é'.repeat(68)` is 72 JS characters and 140 UTF-8 bytes: a
 * `.max(72)` on string length admits it and the server refuses it. This app's
 * user base is EN + es-419, so accented passwords are ordinary, not exotic.
 *
 * Mirrors `mobile/src/screens/auth/authValidation.ts`'s `utf8ByteLength`
 * exactly (same TextEncoder fast path, same code-point-aware fallback) so the
 * two clients agree on what the server will accept.
 */
export function utf8ByteLength(value: string): number {
  const Encoder = (
    globalThis as { TextEncoder?: new () => { encode(input: string): { length: number } } }
  ).TextEncoder;
  if (typeof Encoder === 'function') return new Encoder().encode(value).length;

  // `for...of` iterates CODE POINTS, so an astral character (emoji, or anything
  // outside the BMP) is counted once as its four bytes rather than twice as
  // three — which a `for (i = 0; i < value.length; i++)` loop over UTF-16 code
  // units would get wrong.
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}
