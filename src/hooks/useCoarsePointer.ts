import { useEffect, useState } from 'react';

/**
 * Touch (and stylus) devices, as the BROWSER reports them — never the user
 * agent, never the viewport width. A 13" laptop is fine-pointer at 1280px and
 * an 11" tablet is coarse-pointer at the same width; a UA sniff gets both
 * wrong the moment a device ships that nobody's regex has heard of.
 *
 * A LIST (comma = OR), not a single query, on purpose:
 *   - `(pointer: coarse)` is the decisive one: the PRIMARY input can't hit a
 *     small target. Phones, tablets, TVs.
 *   - `(hover: none)` catches the primary input that can point precisely but
 *     still can't hover — styluses, kiosks, some Android builds that have
 *     historically reported `hover: hover` on a touchscreen and would slip
 *     past the first clause on their own.
 * Both clauses describe the PRIMARY pointer, which is why a touchscreen laptop
 * (mouse primary) stays fine-pointer and keeps segmented typing, and an iPad
 * with a TRACKPAD attached flips to fine-pointer too — correctly, in both cases.
 *
 * AN IPAD WITH ONLY A KEYBOARD (no trackpad) STILL REPORTS COARSE, and that is
 * a deliberate, accepted loss: the field is `readOnly` there, so that user
 * cannot type a date they could have typed before. Accepted because the sheet
 * is fully keyboard-operable — Alt+ArrowDown and F4 open it (both fields
 * intercept those on every pointer class now, precisely for this user), the
 * arrows and Home/End move the selection, Enter commits, Escape returns focus
 * to the field — and because the alternative is worse in a way that cannot be
 * mitigated: an editable input on an iPad summons the OS wheel from focus, and
 * the Smart Keyboard case is indistinguishable at runtime from a bare iPad.
 * `(any-pointer: fine)` would catch it, but it also catches every phone with a
 * stylus and would hand those the 36px rows.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse), (hover: none)';

function readCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(COARSE_POINTER_QUERY).matches
  );
}

/**
 * `true` when the primary pointer is coarse — three decisions hang off it, and
 * NONE of them is "whether this app shows its own picker" any more.
 *
 * WHAT IT DECIDES NOW:
 *   - PRESENTATION. `usePickerPresentation` (`pickerPopover.tsx`) turns this
 *     into `sheet` or `anchored`, and nothing else in the codebase makes that
 *     call. A sheet is full width on the viewport floor with its own scrim; an
 *     anchored panel hangs off the field.
 *   - ROW HEIGHT. `TimePickerPanel` draws 44px rows under a finger and 36 under
 *     a mouse (`TOUCH_ROW_HEIGHT` / `ROW_HEIGHT`).
 *   - `readOnly` ON THE INPUT, in both fields. This is the load-bearing one.
 *
 * WHAT IT USED TO DECIDE, AND WHY THAT CHANGED — do not restore the gate from
 * this comment alone. The fields used to render no popover at all here and hand
 * the job to the OS picker, for three measured reasons, all of which have been
 * answered rather than waved away:
 *   1. The popovers suppress the native dropdown with
 *      `PICKER_INDICATOR_HIDDEN` (`display: none` on
 *      `::-webkit-calendar-picker-indicator`), which is a CHROMIUM-ONLY
 *      affordance and a measured no-op in WebKit: an input's intrinsic width
 *      goes 148px -> 128px in Chromium with the rule applied and 97px -> 97px in
 *      WebKit, i.e. WebKit never drew an indicator to remove and still summons
 *      its wheel from the FOCUSED INPUT. That is still true, and it is still
 *      pinned (`e2e/coarse-pointer.spec.ts`) — it is now the REASON for the
 *      `readOnly` above rather than a reason to stand down, because iOS does not
 *      summon a picker for an input it cannot edit.
 *   2. The geometry: at 390x664 the anchored date panel covered 65% of the Add
 *      Medication modal and intercepted taps on Close, event type, name and
 *      dosage; at 390x360 (keyboard up) the calendar clamped to 176px and showed
 *      about 1.5 of 6 week rows; at 320px the 304px panel was wider than the
 *      modal card. Answered by the sheet, which is sized by the viewport and is
 *      modal, so those taps dismiss it instead of landing on a `gridcell`.
 *   3. Native pickers get VoiceOver/TalkBack, system font scaling, high contrast
 *      and reduced motion for free. Ours now earns them: the sheet is a labelled
 *      `role="dialog"` with `aria-modal`, Escape, a contained Tab cycle, 44px
 *      targets and `motion-reduce:animate-none`, scanned by axe on touch
 *      viewports in the same spec.
 *
 * SUBSCRIBED, not read once: a 2-in-1 that docks or undocks fires `change` on
 * the list, and the widget has to follow it — an anchored panel with 36px rows
 * left behind on a tablet whose keyboard was just detached is the defect, in
 * miniature, that the gate used to exist to prevent.
 *
 * MISSING `matchMedia` RESOLVES TO FALSE (fine pointer), the same shape of
 * fallback `FloatingNavBar` picks for the same jsdom gap. Two reasons it is the
 * safe side: `matchMedia` predates the pointer media features by years, so every
 * engine that can render a touchscreen has it — the fallback can only ever be
 * reached by jsdom and a non-DOM prerender, never by a real phone. And being
 * wrong here degrades to the ANCHORED presentation with 36px rows and a
 * typeable input, which is the desktop behaviour and a safe place to be wrong
 * on a machine that has no pointer to report; a `true` default would make every
 * unit test that does not stub `matchMedia` a test of the sheet, and the
 * anchored path — which is what a real mouse gets — would go unexercised.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(readCoarsePointer);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(COARSE_POINTER_QUERY);
    const apply = (): void => setCoarse(list.matches);
    // Re-read on mount: the lazy initializer ran during render, and a
    // hydrating/SSR'd first render may have answered before `window` was real.
    apply();
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', apply);
      return () => list.removeEventListener('change', apply);
    }
    // Safari < 14 (and jsdom's partial stubs) ship only the deprecated pair.
    list.addListener?.(apply);
    return () => list.removeListener?.(apply);
  }, []);

  return coarse;
}
