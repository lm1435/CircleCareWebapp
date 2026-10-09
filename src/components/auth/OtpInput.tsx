import {
  forwardRef,
  useId,
  useImperativeHandle,
  useRef,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { useTranslation } from 'react-i18next';

export interface OtpInputProps {
  /** Number of digit boxes. */
  length?: number;
  /** The current code (may be shorter than `length` while typing). */
  value: string;
  /** Called with the sanitized code string on every change (max `length`). */
  onChange: (code: string) => void;
  /** Accessible label for the whole group (e.g. "6-digit code"). */
  label: string;
  /** When set, all boxes show the error state and the message is announced. */
  error?: string;
  /** id of the error message, wired to the group via aria-describedby. */
  errorId?: string;
  /**
   * Space-separated ids of other text that describes the code (a hint, a "we
   * just sent one" notice), read with the group on entry, after the error.
   */
  describedBy?: string;
  disabled?: boolean;
  /** Autofocus the first box on mount. */
  autoFocus?: boolean;
  /**
   * When true, boxes accept uppercase letters and digits (invite codes)
   * instead of digits only. Filters to `[A-Z0-9]`, uppercases on entry, uses
   * a text keyboard, and never advertises `autocomplete="one-time-code"`
   * (that hint is reserved for numeric OTP boxes). Default false.
   */
  alphanumeric?: boolean;
}

/**
 * Imperative handle exposed via `ref` — there is no single DOM node to hand a
 * caller (the "field" is six boxes), so callers that need to move focus here
 * (Modal's `initialFocusRef`, an incomplete-code error) get a `.focus()` that
 * focuses box 0, the same target `autoFocus` would land on.
 */
export interface OtpInputHandle {
  focus: () => void;
}

/**
 * Six-segment numeric code input mirroring mobile's ResetPasswordScreen OTP:
 * - one box per digit, auto-advance on entry, backspace moves back
 * - full-code paste distributes across boxes
 * - inputMode="numeric" + autocomplete="one-time-code" on the active box so
 *   browsers/OS surface the SMS/email code
 * - focus / filled / error visual states via tokens (no hardcoded hex)
 * - screen-reader usable: role="group" with an accessible label + error wired
 *   through aria-describedby; each box labeled "Digit N of M"
 *
 * `alphanumeric` switches the same six-box UI to uppercase invite codes
 * (letters + digits) — used by JoinCircleModal. The digit path (default) is
 * unchanged: auth screens keep inputMode="numeric" + one-time-code.
 *
 * TYPING OVER A FILLED BOX (re-typing a rejected code). Every box is
 * `maxLength=1` and selects its character on focus, so a keystroke is meant to
 * REPLACE it. When the typed character EQUALS the one already there the DOM
 * value does not change, React fires no `onChange`, and the box would never
 * advance; the selection collapses and `maxLength` then swallows every key that
 * follows. (In WebKit a click also un-does the select-on-focus selection, so
 * there even a DIFFERENT character was swallowed.) So a plain typed character is
 * handled on `keydown` instead (set this box, move on, whatever the old value or
 * the selection), and `onInput` covers keyboards that report no usable key (see
 * `handleInput`).
 */
export const OtpInput = forwardRef<OtpInputHandle, OtpInputProps>(function OtpInput(
  {
    length = 6,
    value,
    onChange,
    label,
    error,
    errorId,
    describedBy,
    disabled = false,
    autoFocus = false,
    alphanumeric = false,
  },
  ref
): ReactElement {
  const { t } = useTranslation('common');
  const generatedId = useId();
  const groupErrorId = errorId ?? `${generatedId}-otp-error`;
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const sanitize = (raw: string): string =>
    alphanumeric ? raw.replace(/[^A-Z0-9]/gi, '').toUpperCase() : raw.replace(/\D/g, '');

  const digits = sanitize(value).slice(0, length).split('');
  // The first empty box is the "active" entry point.
  const activeIndex = Math.min(digits.length, length - 1);

  const focusBox = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, length - 1));
    inputsRef.current[clamped]?.focus();
    inputsRef.current[clamped]?.select();
  };

  useImperativeHandle(ref, () => ({ focus: () => focusBox(0) }));

  // Write `clean` into the boxes from `index` on, then focus the box after the
  // last one written. `onlyIfChanged` (typed characters) skips `onChange` when
  // the code comes out identical — re-typing the character already in a box must
  // advance without re-reporting the same code (VerifyEmailPage auto-submits on
  // every report of a full code). Paste / browser-inserted text keeps reporting
  // every time, as it always has.
  const place = (index: number, clean: string, onlyIfChanged: boolean): void => {
    const current = sanitize(value).slice(0, length);
    const next = current.split('');
    // Distribute the typed/pasted characters starting at this box.
    let cursor = index;
    for (const ch of clean) {
      if (cursor >= length) break;
      next[cursor] = ch;
      cursor += 1;
    }
    const code = next.join('').slice(0, length);
    if (!onlyIfChanged || code !== current) onChange(code);
    focusBox(Math.min(cursor, length - 1));
  };

  const handleChange = (index: number, raw: string): void => {
    const clean = sanitize(raw);
    if (!clean) return;
    place(index, clean, false);
  };

  // A plain printable key (no Ctrl/Cmd/Alt, so shortcuts and AltGr/Option
  // compositions stay the browser's; not an IME/soft-keyboard keystroke, which
  // reports "Process"/"Unidentified" or keyCode 229). Its character is applied
  // here and the browser's own insertion is cancelled, so the result never
  // depends on what the box held or on where the selection happens to be.
  const isTypedCharacter = (event: KeyboardEvent<HTMLInputElement>): boolean =>
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.nativeEvent.isComposing &&
    event.keyCode !== 229;

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = sanitize(value).slice(0, length).split('');
      if (next[index]) {
        // Clear the current box, stay put.
        next[index] = '';
        onChange(next.join(''));
      } else if (index > 0) {
        // Already empty — clear and move to the previous box.
        next[index - 1] = '';
        onChange(next.join(''));
        focusBox(index - 1);
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      focusBox(index + 1);
    } else if (isTypedCharacter(event)) {
      event.preventDefault();
      // A character this mode does not accept (a letter in a digit box, a
      // space, a dash) is dropped; the box keeps what it had.
      const clean = sanitize(event.key);
      if (clean) place(index, clean, true);
    }
  };

  // Safety net for keyboards that give `keydown` no usable key — Android soft
  // keyboards ("Unidentified"/229), IMEs, dictation, assistive tech inserting
  // text directly. The browser then replaces the selected character itself, and
  // if it is the SAME character the value is unchanged, React withholds
  // `onChange`, and focus would stall. The native `input` event still fires
  // (Chromium and WebKit both), so advance from here. A real change is left to
  // `onChange`, which advances focus itself.
  const handleInput = (index: number, event: FormEvent<HTMLInputElement>): void => {
    const native = event.nativeEvent as InputEvent;
    if (native.isComposing || native.inputType !== 'insertText') return;
    if (!sanitize(native.data ?? '')) return;
    if (event.currentTarget.value !== (digits[index] ?? '')) return;
    focusBox(Math.min(index + 1, length - 1));
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    const pasted = sanitize(event.clipboardData.getData('text'));
    if (!pasted) return;
    handleChange(index, pasted);
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={[error ? groupErrorId : null, describedBy || null].filter(Boolean).join(' ') || undefined}
      className="flex flex-col gap-1.5"
    >
      <div className="flex gap-2">
        {Array.from({ length }).map((_, index) => {
          const digit = digits[index] ?? '';
          const isActive = !disabled && index === activeIndex;
          const stateClass = error
            ? 'border-terracotta'
            : digit
              ? 'border-ink bg-bg-2'
              : 'border-line-strong';
          return (
            <input
              key={index}
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              type="text"
              inputMode={alphanumeric ? 'text' : 'numeric'}
              pattern={alphanumeric ? undefined : '[0-9]*'}
              autoComplete={!alphanumeric && isActive ? 'one-time-code' : 'off'}
              autoCapitalize={alphanumeric ? 'characters' : undefined}
              maxLength={1}
              disabled={disabled}
              autoFocus={autoFocus && index === 0}
              value={digit}
              aria-label={
                alphanumeric
                  ? t('otpCharacter', { index: index + 1, length })
                  : t('otpDigit', { index: index + 1, length })
              }
              aria-invalid={error ? true : undefined}
              onChange={(event) => handleChange(index, event.target.value)}
              onInput={(event) => handleInput(index, event)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onPaste={(event) => handlePaste(index, event)}
              onFocus={(event) => event.target.select()}
              // card-shell-ok: a single OTP digit input cell, not a card.
              className={`h-14 w-full min-w-0 flex-1 rounded-md border bg-cream text-center text-2xl font-semibold text-ink transition-colors focus:border-moss focus:shadow-[0_0_0_1px_var(--color-moss)] focus:outline-none disabled:opacity-50 ${stateClass}`}
            />
          );
        })}
      </div>
    </div>
  );
});
