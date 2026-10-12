import type { ChangeEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/components/ui';
import { sanitizeExtension } from '@/lib/phone';

export interface ExtensionFieldProps {
  /** Id of the input; its helper is `${id}-hint` (wired by TextField). */
  id: string;
  /** Digits only, at most {@link EXTENSION_MAX_LENGTH}. */
  value: string;
  onChange: (digits: string) => void;
  /**
   * Whether the phone number above it is filled in. An extension means nothing
   * without a number, so the field is DISABLED while the number is empty (and
   * shows empty; the typed digits are kept in the form and come back with the
   * number). The saved value is null in that case either way.
   */
  hasPhone: boolean;
}

/**
 * The optional phone extension, placed directly under the phone row of a
 * doctor / insurance form. A real labelled input with a described-by helper
 * ("Optional", or why it is disabled), numeric keypad on touch devices, digits
 * only as typed (pasted "ext. 12-3" becomes "123"), 10 max. Mobile twin: the
 * extension input under PhoneInput.
 */
export function ExtensionField({ id, value, onChange, hasPhone }: ExtensionFieldProps): ReactElement {
  const { t } = useTranslation('emergency');
  return (
    // Short on purpose (10 digits): ~11rem is wide enough at 200% zoom and keeps
    // the field visibly subordinate to the number above it.
    <div className="max-w-[11rem]">
      <TextField
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        // No maxLength attribute: the browser would cut a PASTED "ext. 12-34" to ten
        // raw characters BEFORE the non-digits are stripped. sanitizeExtension caps at 10.
        label={t('phone.extension')}
        hint={hasPhone ? t('phone.extensionHint') : t('phone.extensionNeedsPhone')}
        disabled={!hasPhone}
        value={hasPhone ? value : ''}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(sanitizeExtension(e.target.value))}
      />
    </div>
  );
}
