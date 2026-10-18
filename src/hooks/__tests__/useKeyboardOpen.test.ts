import { describe, expect, it } from 'vitest';
import { isKeyboardOpen } from '../useKeyboardOpen';

describe('isKeyboardOpen', () => {
  const full = { height: 800, scale: 1 };
  it('false without a text field focused', () => {
    expect(isKeyboardOpen({ height: 400, scale: 1 }, 800, false)).toBe(false);
  });
  it('false when the viewport is not shrunk (desktop, hardware keyboard)', () => {
    expect(isKeyboardOpen(full, 800, true)).toBe(false);
  });
  it('false for small chrome changes (URL bar)', () => {
    expect(isKeyboardOpen({ height: 720, scale: 1 }, 800, true)).toBe(false);
  });
  it('true when a text field is focused and the viewport lost a big share', () => {
    expect(isKeyboardOpen({ height: 420, scale: 1 }, 800, true)).toBe(true);
  });
  it('false under pinch-zoom', () => {
    expect(isKeyboardOpen({ height: 400, scale: 2 }, 800, true)).toBe(false);
  });
  it('false without visualViewport', () => {
    expect(isKeyboardOpen(null, 800, true)).toBe(false);
  });
});
