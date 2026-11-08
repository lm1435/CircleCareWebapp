import type { ReactElement, ReactNode } from 'react';
import { Text } from './Text';
import { RequiredMarker } from './RequiredMarker';
import { INPUT_LABEL } from './inputStyles';

export interface FieldLabelProps {
  htmlFor: string;
  /** The field must be filled before Save: appends the aria-hidden red asterisk. */
  required?: boolean;
  /** Extra classes on the <label> (e.g. `sr-only` when a visible question heading names the field). */
  className?: string;
  children: ReactNode;
}

/**
 * The shared field label (TextField, TextArea, Select, DateField, TimeField): a real
 * `<label htmlFor>` with the 14/500 label type, and the required asterisk when `required`
 * (owner 2026-11-07, mobile parity). The control itself sets `aria-required`.
 */
export function FieldLabel({ htmlFor, required, className, children }: FieldLabelProps): ReactElement {
  return (
    <label htmlFor={htmlFor} className={className ? `${INPUT_LABEL} ${className}` : INPUT_LABEL}>
      <Text variant="label" as="span">
        {children}
        {required ? <RequiredMarker /> : null}
      </Text>
    </label>
  );
}
