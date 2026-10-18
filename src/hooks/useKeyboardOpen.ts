import { useEffect, useState } from 'react';

/**
 * How much of the layout viewport the VISUAL viewport must lose before we call
 * it an on-screen keyboard. A soft keyboard takes 35-50% of the screen; browser
 * chrome collapsing (URL bar) costs well under 15%.
 */
const KEYBOARD_VIEWPORT_RATIO = 0.75;

/** `<input>` types that bring up a keyboard (checkbox/radio/range/etc. do not). */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function isTextEntryFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Pure decision, exported for tests. The keyboard is "up" when a text field has
 * focus AND the visual viewport is much shorter than the layout viewport. Both
 * are required: the height alone also shrinks under pinch-zoom (`scale > 1`),
 * and focus alone is true on a desktop with a hardware keyboard.
 */
export function isKeyboardOpen(
  viewport: Pick<VisualViewport, 'height' | 'scale'> | null | undefined,
  layoutHeight: number,
  textEntryFocused: boolean
): boolean {
  if (!viewport || !textEntryFocused) return false;
  if (viewport.scale > 1.01) return false;
  return viewport.height < layoutHeight * KEYBOARD_VIEWPORT_RATIO;
}

/**
 * True while a phone's on-screen keyboard is (very likely) up. Desktop browsers
 * never shrink the visual viewport for a keyboard, so this is always false
 * there; it is a progressive enhancement for mobile browsers, not a guarantee
 * (a browser that resizes the layout viewport instead of the visual one
 * reports no difference and the result stays false).
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const update = (): void => {
      setOpen(isKeyboardOpen(viewport, window.innerHeight, isTextEntryFocused()));
    };
    update();
    viewport.addEventListener('resize', update);
    // Focus moves between fields do not always resize the viewport.
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);

  return open;
}
