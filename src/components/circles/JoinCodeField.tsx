import { forwardRef, type ReactElement } from 'react';
import { TextField } from '@/components/ui';
import { JOIN_CODE_LENGTH, normalizeJoinCode } from '@/lib/joinCode';

/**
 * The invite-code field (1.4.3): ONE text field, not a row of boxes, exactly as mobile
 * (JoinCircleScreen / JoinCircleModal: one Input, maxLength 8). A code is 6 OR 8 characters; eight
 * boxes did not fit a phone (glyphs touched the box edges, a "W" was clipped) and a 6-character code
 * left two empty boxes beside an enabled Find circle. Normalised as typed (uppercase, spaces and
 * dashes stripped), so a pasted "abcd-2345" reads ABCD2345. Submit readiness stays the caller's
 * (`isCompleteJoinCode`: exactly 6 or 8).
 */
export interface JoinCodeFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (code: string) => void;
  error?: string;
  hint?: string;
  testId?: string;
}

export const JoinCodeField = forwardRef<HTMLInputElement, JoinCodeFieldProps>(function JoinCodeField(
  { id, label, value, onChange, error, hint, testId },
  ref
): ReactElement {
  return (
    <TextField
      ref={ref}
      id={id}
      name="invite_code"
      label={label}
      value={value}
      onChange={(e) => onChange(normalizeJoinCode(e.target.value).slice(0, JOIN_CODE_LENGTH))}
      maxLength={JOIN_CODE_LENGTH + 4}
      autoComplete="one-time-code"
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      inputMode="text"
      placeholder="ABCD2345"
      required
      error={error}
      hint={hint}
      data-testid={testId}
      className="font-mono text-lg tracking-[0.2em] uppercase"
    />
  );
});
