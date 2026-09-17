import {
  forwardRef,
  lazy,
  Suspense,
  useCallback,
  useId,
  useRef,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { useMenu } from '@/hooks/useMenu';
import { Icon } from './Icon';
import { emitNativeChange, opensNativePicker } from './pickerField';
import { RequiredMarker } from './RequiredMarker';
import { Text } from './Text';
import {
  INPUT_ERROR,
  INPUT_HINT,
  INPUT_LABEL,
  INPUT_TEXT,
  INPUT_TRAILING,
  fieldShell,
  PICKER_INDICATOR_HIDDEN,
} from './inputStyles';

/**
 * LAZY ON PURPOSE — see the module comment in `TimePickerPanel`. That module
 * calls `useHourCycle`, whose import chain reaches `store/authStore` and from
 * there the i18n bootstrap, PostHog and the API client. `components/ui` is
 * otherwise free of stores and API modules, and it is imported by nearly every
 * screen; a static edge here would have pulled all of that into the barrel.
 * The popover only exists once someone opens it, so the import can wait too.
 */
const TimePickerPanel = lazy(() => import('./TimePickerPanel'));

export interface TimeFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
}

/**
 * `<input type="time">` in the §4.5 shell, with the app's own `time-outline` in
 * the trailing slot — now a real button that opens OUR popover
 * (`TimePickerPanel`) instead of Chrome's native time wheel.
 *
 * THE NATIVE INPUT STAYS. It is still the text control, and deliberately so:
 * segmented typing, arrow-key increment, digit entry and per-locale 12h/24h
 * display are all free, and it is what emits and accepts the `HH:MM` 24-hour
 * string this field's whole contract — and all of `utils/timezone.ts` — is
 * written against. Only the browser's DROPDOWN is replaced: its picker button
 * is removed outright (`PICKER_INDICATOR_HIDDEN`, which `DateField` now shares
 * for the same reason — it used to keep the indicator alive because there was
 * no replacement for the native calendar, and there is one now), because a
 * system-blue wheel one click away from our own popover is two pickers on one
 * field.
 *
 * ON EVERY DEVICE — and `readOnly` is the price of that on touch.
 *
 * This field used to stand down entirely on a coarse pointer and hand the job
 * back to the phone's own wheel, because `PICKER_INDICATOR_HIDDEN` is a
 * Chromium affordance and a MEASURED no-op in WebKit (input width 148->128 in
 * Chromium, 97->97 in WebKit): WebKit never laid out an indicator to remove and
 * opens its wheel from the FOCUSED INPUT, so our popover on top of it was the
 * second picker on one field. `readOnly` is what closes that route — iOS does
 * not summon a wheel for an input it cannot edit — and the tap it used to
 * intercept is routed to our popover instead (`handleInputClick`).
 *
 * WHAT THAT COSTS, AND WHY IT IS THE RIGHT TRADE. `readOnly` gives up segmented
 * typing and arrow-key increment, which are DESKTOP affordances: nobody types
 * `09`, `15`, `AM` into three segments on a phone, and the OS wheel that was
 * the touch experience until now offered no typing either. So touch loses
 * nothing it had, and fine pointers keep all of it — the flag is scoped to
 * `useCoarsePointer`, which reports the PRIMARY pointer, so a touchscreen
 * laptop and an iPad with a trackpad both stay typeable.
 *
 * AND IT BARS THE INPUT FROM CONSTRAINT VALIDATION, which is the sharp edge
 * here: HTML exempts `readonly` controls, so a `required` readOnly field does
 * not block a native submit. That is safe in this app because it was never the
 * browser doing the blocking — every form these fields appear in validates with
 * `useZodForm`, and the only one that passes `required` to a picker
 * (`AddEventModal`) carries `noValidate`. `src/__tests__/bans/
 * pickerRequiredValidation.test.ts` is what keeps that true for forms not yet
 * written. `required` still draws the marker and still sets `aria-required`.
 *
 * The value is an `HH:MM` string — callers own timezone-correct formatting.
 */
export const TimeField = forwardRef<HTMLInputElement, TimeFieldProps>(function TimeField(
  { id, label, error, hint, className, disabled, required, readOnly, ...rest },
  ref
) {
  const { t } = useTranslation();
  const coarse = useCoarsePointer();
  const menu = useMenu();
  const panelId = useId();
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The input is both the caller's (`ref`) and ours — we need it to write the
  // popover's picks back through the native change path below.
  const setInputRef = useCallback(
    (node: HTMLInputElement | null): void => {
      inputRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as MutableRefObject<HTMLInputElement | null>).current = node;
      }
    },
    [ref]
  );

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;

  const shell = fieldShell({ error: Boolean(error), disabled, extra: 'relative' });

  // UNCONDITIONAL NOW. The overlay bargain (keep the indicator alive but
  // transparent, so the browser's own wheel stays reachable) was the right
  // trade only while there was nothing to reach instead, and on touch that was
  // the last thing still pointing at the native wheel. Both of its routes are
  // closed here: this class removes Chromium's indicator, and `readOnly` below
  // removes WebKit's focus route, which is the one this class cannot touch.
  const control = `${INPUT_TEXT} appearance-none ${PICKER_INDICATOR_HIDDEN}`;

  const handlePick = useCallback((next: string): void => {
    if (inputRef.current) emitNativeChange(inputRef.current, next);
  }, []);

  /**
   * WHERE THE POPOVER WAS OPENED FROM, because that is where focus has to go
   * back to — and the two answers are different controls.
   *
   * Every exit path funnels through one `onDismiss`, which used to be
   * `menu.close(true)`: close, and focus `menu.buttonRef`. Right for the
   * trigger, wrong for the keyboard route below. Alt+ArrowDown (and F4) is the
   * INPUT's native picker opener, intercepted here and pointed at our popover,
   * so a keyboard user who tabs into the field, opens the picker and presses
   * Escape was left on the trailing icon button — one Shift+Tab PAST the
   * segment they were editing, with nothing to say so. Native
   * `<input type="time">` returns focus to the input in exactly this flow.
   *
   * A ref rather than state: nothing renders differently, and it must be
   * readable by the dismiss that runs in the same event as the close.
   */
  const openedFromInput = useRef(false);

  const handleDismiss = useCallback((): void => {
    if (openedFromInput.current) {
      // `close(false)`: `useMenu` would focus the trigger, which is the thing
      // being corrected. The focus call is synchronous and lands before the
      // panel unmounts, so nothing has to chase it afterwards.
      menu.close(false);
      inputRef.current?.focus();
      return;
    }
    menu.close(true);
  }, [menu]);

  /**
   * A TAP ON THE INPUT IS THE TAP THAT USED TO OPEN THE OS WHEEL.
   *
   * Coarse only: on a fine pointer the input is a text control people click
   * into to type a segment, and hijacking that click would be a regression for
   * the affordance `readOnly` deliberately preserves there.
   *
   * No double-toggle race, by construction: once the popover is open the SHEET
   * presentation lays a scrim over the whole viewport, so this input cannot be
   * tapped again until it has closed. `openedFromInput` so the dismiss puts
   * focus back where the finger was, not on the trailing button.
   */
  const handleInputClick = useCallback(
    (event: ReactMouseEvent<HTMLInputElement>): void => {
      if (coarse && !disabled && !menu.open) {
        openedFromInput.current = true;
        menu.toggle();
      }
      rest.onClick?.(event);
    },
    [coarse, disabled, menu, rest]
  );

  // Alt+ArrowDown / F4 is the keyboard route into the native wheel, which
  // removing the picker indicator does not close — see `opensNativePicker`.
  // Intercepted on BOTH pointer classes now: an iPad with a keyboard attached
  // still reports coarse, and leaving the route open there would summon the
  // very wheel `readOnly` exists to keep shut.
  const handleInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (opensNativePicker(event)) {
        event.preventDefault();
        if (!menu.open) {
          openedFromInput.current = true;
          menu.toggle();
        }
      } else if (menu.open && event.key === 'Escape') {
        // ESCAPE IN THE WINDOW WHERE THIS WIDGET HAS NO KEY HANDLER AT ALL.
        //
        // `PickerPopover` owns Escape — and it owns it on the PANEL, which is
        // behind `React.lazy` with `fallback={null}`. Between the keystroke above
        // setting `menu.open` and the chunk landing there is nothing in the DOM
        // to hold that handler, so Escape bubbled to the `Modal` these fields
        // always live in and closed the DIALOG, discarding a half-filled form,
        // over a popover that had not appeared yet. One frame on a warm cache;
        // a real window on a cold one over a slow link.
        //
        // Only reachable in exactly that state: once the panel mounts it takes
        // focus, and a keydown on the input cannot happen while it holds it. The
        // trigger's half of the same gap is already covered — `useMenu`'s
        // `onButtonKeyDown` swallows Escape whenever its own `open` is true.
        event.preventDefault();
        event.stopPropagation();
        handleDismiss();
      }
      rest.onKeyDown?.(event);
    },
    [menu, rest, handleDismiss]
  );

  // The trigger's two open gestures, both of which mean "focus belongs on the
  // trigger afterwards". Cleared unconditionally: once the popover is open,
  // focus is inside the panel and neither of these can fire again until it has
  // closed.
  const handleTriggerClick = useCallback((): void => {
    openedFromInput.current = false;
    menu.toggle();
  }, [menu]);

  const handleTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>): void => {
      openedFromInput.current = false;
      menu.onButtonKeyDown(event);
    },
    [menu]
  );

  /*
   * NO TEARDOWN ON A POINTER-CLASS FLIP ANY MORE, and its absence is the
   * change. A `!coarse &&` render guard used to unmount this popover the moment
   * a 2-in-1 undocked, which forced an effect here to catch the focus the
   * unmounting PORTAL dropped on `<body>` and to write `menu.open` back to
   * false so a redock did not re-open a picker nobody had asked for. Both
   * problems were consequences of the gate. `PickerPopover` now re-presents
   * itself as a sheet instead of disappearing, so focus never leaves the panel
   * and `menu.open` is never contradicted by what is on screen.
   */

  return (
    <div>
      <label htmlFor={id} className={INPUT_LABEL}>
        <Text variant="label" as="span">
          {label}
          {required ? <RequiredMarker /> : null}
        </Text>
      </label>
      <div ref={shellRef} className={shell}>
        <input
          ref={setInputRef}
          id={id}
          type="time"
          disabled={disabled}
          required={required}
          // TOUCH CANNOT TYPE HERE, ON PURPOSE — see the header. This is the
          // only thing that stops WebKit opening its own wheel from the focused
          // input, which `PICKER_INDICATOR_HIDDEN` provably cannot.
          readOnly={coarse || readOnly}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className ? `${control} ${className}` : control}
          {...rest}
          onClick={handleInputClick}
          onKeyDown={handleInputKeyDown}
        />
        {/*
          ONE TRAILING CONTROL ON EVERY DEVICE. Touch used to get a decorative
          `aria-hidden` span instead, because the transparent native indicator
          underneath it was the real button and carried its own
          browser-supplied name — a second named control would have been read
          twice. That indicator is gone on every pointer class now, so this is
          the only thing anyone clicks to reach the picker and it is named.
        */}
        <button
          ref={menu.buttonRef}
          type="button"
          aria-label={t('common:timePicker.open')}
          aria-haspopup="dialog"
          aria-expanded={menu.open}
          // `undefined` while shut: the panel is not in the DOM yet and a
          // dangling idref is invalid ARIA (the point `MoreMenu` documents).
          aria-controls={menu.open ? panelId : undefined}
          disabled={disabled}
          onClick={handleTriggerClick}
          onKeyDown={handleTriggerKeyDown}
          className={`${INPUT_TRAILING} rounded-md transition-colors hover:text-ink disabled:cursor-not-allowed`}
        >
          <Icon name="time-outline" size="inline" />
        </button>
      </div>
      {menu.open ? (
        // `fallback={null}`: the one frame between the click and the chunk
        // arriving has nothing useful to show, and a spinner under a field
        // would be a worse answer than the panel simply appearing.
        <Suspense fallback={null}>
          <TimePickerPanel
            id={panelId}
            anchorRef={shellRef}
            panelRef={menu.menuRef}
            triggerRef={menu.buttonRef}
            // Every call site is controlled, so `rest.value` is the answer. The
            // DOM fallback is for an UNCONTROLLED field (no `value` prop at
            // all, which the passthrough props allow): the panel only mounts on
            // open, by which point the input exists and holds whatever was
            // typed, so the popover still opens on the real value, not on noon.
            value={typeof rest.value === 'string' ? rest.value : (inputRef.current?.value ?? '')}
            onPick={handlePick}
            onDismiss={handleDismiss}
          />
        </Suspense>
      ) : null}
      {hint ? (
        <Text variant="caption" id={hintId} className={INPUT_HINT}>
          {hint}
        </Text>
      ) : null}
      {error ? (
        <p id={errorId} className={INPUT_ERROR}>
          <Icon name="alert-circle-outline" size="inline" />
          {error}
        </p>
      ) : null}
    </div>
  );
});
