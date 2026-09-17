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
 * LAZY ON PURPOSE — see the module comment in `DatePickerPanel`, and the same
 * note on `TimeField`. The panel reaches `utils/timezone` (and through it the
 * API client) for "today" in the viewer's zone, carries four `Intl` formatters
 * and a 42-cell grid, and `components/ui` is imported by nearly every screen.
 * A static edge here would have put all of it in the first chunk for a control
 * most sessions never open.
 */
const DatePickerPanel = lazy(() => import('./DatePickerPanel'));

export interface DateFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  id: string;
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
}

/**
 * `min` / `max` as the PANEL can use them, or `undefined`.
 *
 * They arrive through the props spread typed as `string | number | readonly
 * string[]` (the shape `<input>` declares for every input type it has), so
 * anything that is not an ISO day — a number left over from a `type="number"`
 * copy-paste, a stray array — is dropped rather than compared against an ISO
 * string, where `5 < '2026-01-01'` is a coercion, not a range check. No call
 * site passes either today; the spread allows it, and DOB will want
 * `max={today}`.
 *
 * WHAT THIS GUARANTEES, EXACTLY — and the comment above it used to claim more.
 * It answers "is this safe to COMPARE as a bound", which is the only question
 * the one consumer asks: `clampDateValue` is a string comparison, exact for
 * `YYYY-MM-DD` because the format is fixed-width and most-significant-first,
 * and it never parses either bound. Nothing downstream re-checks them either —
 * `parseDateValue`, the real calendar validator, is applied to the VALUE and
 * to the clamp's output, never to `min`/`max`. So a bound of the right shape
 * and no calendar meaning wins the clamp, becomes the anchor the grid opens
 * on, and is then rejected by `parseDateValue`, dropping the panel on its
 * epoch fallback: a September 2026 field opening on JANUARY 1970. The old
 * `\d{2}-\d{2}` admitted `2026-13-45` and did exactly that.
 *
 * It does NOT guarantee the day exists: `2026-02-30` and `2027-02-29` pass.
 * Catching those needs `daysInMonth`, which lives in `DatePickerPanel` behind
 * this field's `React.lazy` boundary — importing it here would pull the panel,
 * its four `Intl` formatters and its reach into `utils/timezone` back into the
 * barrel every screen loads, and re-implementing leap years here would be the
 * second copy this codebase keeps paying for. A month-end that does not exist
 * is a bound a day or two off; a month of 13 is a different century.
 */
function isoDayProp(value: InputHTMLAttributes<HTMLInputElement>['min']): string | undefined {
  return typeof value === 'string' &&
    /^[1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value.trim())
    ? value.trim()
    : undefined;
}

/**
 * `<input type="date">` in the §4.5 shell, with the app's own `calendar-outline`
 * in the trailing slot — a real button that opens OUR popover
 * (`DatePickerPanel`) rather than Chrome's native calendar.
 *
 * THE NATIVE INPUT STAYS. It is still the text control, and deliberately so:
 * segmented typing, arrow-key increment, digit entry and locale-aware display
 * ORDER are all free, and it is what emits and accepts the `YYYY-MM-DD` string
 * this field's whole contract is written against. Only the browser's DROPDOWN
 * is replaced — its picker button is removed outright
 * (`PICKER_INDICATOR_HIDDEN`, now shared with `TimeField`), because a
 * system-blue calendar with system-blue "Clear"/"Today" links one click away
 * from our own popover is two pickers on one field.
 *
 * ON EVERY DEVICE — and `readOnly` is the price of that on touch. The reasoning
 * is written out once, in `TimeField`, which carries the identical pair; in
 * short, `PICKER_INDICATOR_HIDDEN` is a Chromium affordance and a MEASURED
 * no-op in WebKit (input width 148->128 in Chromium, 97->97 in WebKit), which
 * opens its calendar from the FOCUSED INPUT rather than from a button, so
 * `readOnly` is the only thing that can close that route — and losing segmented
 * typing costs a phone nothing, because the OS calendar it replaces offered
 * none either. The sharp edge, also documented there: `readonly` bars an input
 * from CONSTRAINT VALIDATION, which is safe here only because every form these
 * fields live in validates with `useZodForm` and the one that marks a picker
 * `required` carries `noValidate` (pinned by
 * `src/__tests__/bans/pickerRequiredValidation.test.ts`).
 *
 * The value is a `YYYY-MM-DD` string — callers own timezone-correct formatting.
 */
export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
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
  // popover's picks back through the native change path.
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

  // Unconditional now — both routes into the native calendar are closed on
  // every pointer class: this class removes Chromium's indicator, `readOnly`
  // below removes WebKit's focus route. See `TimeField` for the full note.
  const control = `${INPUT_TEXT} appearance-none ${PICKER_INDICATOR_HIDDEN}`;

  const handlePick = useCallback((next: string): void => {
    if (inputRef.current) emitNativeChange(inputRef.current, next);
  }, []);

  /**
   * WHERE THE POPOVER WAS OPENED FROM, because that is where focus has to go
   * back to — and the two answers are different controls. The reasoning is
   * written out once, in `TimeField`, which carries the identical pair: in
   * short, every exit path funnels through one `onDismiss` that used to focus
   * `menu.buttonRef` unconditionally, so a keyboard user who tabbed into the
   * input, opened the calendar with Alt+ArrowDown and pressed Escape landed on
   * the trailing icon button — one Shift+Tab past the date segment they were
   * editing. Native `<input type="date">` returns focus to the input here.
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

  // A tap on the input is the tap that used to open the OS calendar; coarse
  // only, so a fine pointer keeps the click that puts a caret in a segment.
  // The reasoning, and why the sheet's scrim makes a double-toggle impossible,
  // is written out once in `TimeField`.
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

  // Alt+ArrowDown / F4 is the keyboard route into the native calendar, which
  // removing the picker indicator does not close — see `opensNativePicker`.
  // Intercepted on both pointer classes: an iPad with a keyboard attached still
  // reports coarse, and that route would summon the calendar `readOnly` exists
  // to keep shut.
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
   * NO TEARDOWN ON A POINTER-CLASS FLIP ANY MORE — the effect that used to live
   * here went with the gate it was cleaning up after. `TimeField` carries the
   * full note.
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
          type="date"
          disabled={disabled}
          required={required}
          // Touch cannot type here, on purpose — see the header and `TimeField`.
          readOnly={coarse || readOnly}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={className ? `${control} ${className}` : control}
          {...rest}
          onClick={handleInputClick}
          onKeyDown={handleInputKeyDown}
        />
        {/* One named trailing control on every device — see `TimeField`. */}
        <button
          ref={menu.buttonRef}
          type="button"
          aria-label={t('common:datePicker.open')}
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
          <Icon name="calendar-outline" size="inline" />
        </button>
      </div>
      {menu.open ? (
        // `fallback={null}`: the one frame between the click and the chunk
        // arriving has nothing useful to show, and a spinner under a field
        // would be a worse answer than the panel simply appearing.
        <Suspense fallback={null}>
          <DatePickerPanel
            id={panelId}
            anchorRef={shellRef}
            panelRef={menu.menuRef}
            triggerRef={menu.buttonRef}
            // Every call site is controlled, so `rest.value` is the answer. The
            // DOM fallback is for an UNCONTROLLED field (no `value` prop at all,
            // which the passthrough props allow): the panel only mounts on open,
            // by which point the input exists and holds whatever was typed, so
            // the calendar still opens on the real value, not on today.
            value={typeof rest.value === 'string' ? rest.value : (inputRef.current?.value ?? '')}
            min={isoDayProp(rest.min)}
            max={isoDayProp(rest.max)}
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
