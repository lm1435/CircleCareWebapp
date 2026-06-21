import { useId, useRef, type ClipboardEvent, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface OtpInputProps {
  /** Number of digit boxes. */
  length?: number;
  /** The current code (may be shorter than `length` while typing). */
  value: string;
  /** Called with the digits-only string on every change (max `length`). */
  onChange: (code: string) => void;
  /** Accessible label for the whole group (e.g. "6-digit code"). */
  label: string;
  /** When set, all boxes show the error state and the message is announced. */
  error?: string;
  /** id of the error message, wired to the group via aria-describedby. */
  errorId?: string;
  disabled?: boolean;
  /** Autofocus the first box on mount. */
  autoFocus?: boolean;
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
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  label,
  error,
  errorId,
  disabled = false,
  autoFocus = false,
}: OtpInputProps): ReactElement {
  const { t } = useTranslation('common');
  const generatedId = useId();
  const groupErrorId = errorId ?? `${generatedId}-otp-error`;
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const digits = value.replace(/\D/g, '').slice(0, length).split('');
  // The first empty box is the "active" entry point.
  const activeIndex = Math.min(digits.length, length - 1);

  const focusBox = (index: number): void => {
    const clamped = Math.max(0, Math.min(index, length - 1));
    inputsRef.current[clamped]?.focus();
    inputsRef.current[clamped]?.select();
  };

  const handleChange = (index: number, raw: string): void => {
    const onlyDigits = raw.replace(/\D/g, '');
    if (!onlyDigits) return;

    const next = value.replace(/\D/g, '').slice(0, length).split('');
    // Distribute the typed/pasted digits starting at this box.
    let cursor = index;
    for (const ch of onlyDigits) {
      if (cursor >= length) break;
      next[cursor] = ch;
      cursor += 1;
    }
    const code = next.join('').slice(0, length);
    onChange(code);
    focusBox(Math.min(cursor, length - 1));
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      const next = value.replace(/\D/g, '').slice(0, length).split('');
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
    }
  };

  const handlePaste = (index: number, event: ClipboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '');
    if (!pasted) return;
    handleChange(index, pasted);
  };

  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={error ? groupErrorId : undefined}
      className="flex flex-col gap-1.5"
    >
      <div className="flex gap-2">
        {Array.from({ length }).map((_, index) => {
          const digit = digits[index] ?? '';
          const isActive = !disabled && index === activeIndex;
          const stateClass = error
            ? 'border-terracotta-deep'
            : digit
              ? 'border-ink bg-bg-2'
              : 'border-line';
          return (
            <input
              key={index}
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={isActive ? 'one-time-code' : 'off'}
              maxLength={1}
              disabled={disabled}
              autoFocus={autoFocus && index === 0}
              value={digit}
              aria-label={t('otpDigit', { index: index + 1, length })}
              aria-invalid={error ? true : undefined}
              onChange={(event) => handleChange(index, event.target.value)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onPaste={(event) => handlePaste(index, event)}
              onFocus={(event) => event.target.select()}
              className={`h-14 w-full min-w-0 flex-1 rounded-xl border-2 bg-cream text-center text-2xl font-semibold text-ink transition-colors focus:border-ink focus:outline-none disabled:opacity-50 ${stateClass}`}
            />
          );
        })}
      </div>
    </div>
  );
}
