/**
 * The two things `DateField` and `TimeField` need that their POPOVERS do not —
 * so they live on the eager side of the `React.lazy` boundary, where the fields
 * are, rather than in `pickerPopover.tsx` with the rest of the shared machinery.
 * Importing that module from a field would pull the portal, the panels and
 * `react-dom`'s `createPortal` back into `components/ui`'s barrel, which is
 * precisely what the lazy edge exists to prevent.
 */

/**
 * Push a value into the native input the way a USER would, so React's own
 * `onChange` fires with a real event whose `target` is this input.
 *
 * Why not call the caller's `onChange` with a hand-made object: `DateFieldProps`
 * and `TimeFieldProps` are passthroughs (`value`/`onChange` arrive in `...rest`),
 * and every call site in this app reads `e.target.value` — `AddEventModal`,
 * `ProfilePage`'s quiet hours, `VitalFormModal`, `CreateCircleModal`,
 * `EditCirclePage`, the first-run wizard. A synthetic stand-in would have to
 * fake `target`, `currentTarget`, and whatever the next call site reaches for.
 * Writing through the PROTOTYPE setter instead bypasses the per-node value
 * tracker React installs on the element (that tracker is an own property; the
 * prototype descriptor is the original), so React sees the value as changed and
 * dispatches a genuine `ChangeEvent`. This is the standard "programmatic input"
 * idiom and it is the only thing that keeps both props APIs — and all nine call
 * sites — untouched.
 */
export function emitNativeChange(input: HTMLInputElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) {
    setter.call(input, next);
  } else {
    input.value = next;
  }
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * The KEYBOARD route into the browser's own date/time dropdown.
 *
 * Removing the picker indicator (`PICKER_INDICATOR_HIDDEN`) closes the mouse
 * route into it and nothing else: Alt+ArrowDown and F4 still open Chrome's
 * native calendar or time wheel from a focused `<input type="date">` /
 * `type="time"`. Both fields intercept it and open OUR popover instead, so the
 * keyboard and the mouse reach the same control rather than two different ones
 * — one of which is system blue and drawn by the browser chrome.
 *
 * Structurally typed rather than taking a `KeyboardEvent` so this file stays
 * free of React's types; both call sites hand it a React synthetic event.
 */
export function opensNativePicker(event: { altKey: boolean; key: string }): boolean {
  return (event.altKey && event.key === 'ArrowDown') || event.key === 'F4';
}
