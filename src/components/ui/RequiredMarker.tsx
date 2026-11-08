import type { ReactElement } from 'react';

/**
 * Shared required-field indication appended to a field label (WCAG SC 3.3.2 / 3.3.1): a visible
 * red asterisk, aria-hidden (owner 2026-11-07, mobile parity). The requirement reaches assistive
 * tech through the control's own `aria-required` / `required`, so the label carries no sr-only
 * "(required)" text: the field's name stays exactly its label and "required" is announced once.
 *
 * Colour: the field-error token (`INPUT_ERROR`'s text-terracotta: light 5.63 / 5.35:1, dark
 * 5.62 / 6.13:1 on card / page).
 */
export function RequiredMarker(): ReactElement {
  return (
    <span aria-hidden="true" className="text-terracotta">
      {' '}
      *
    </span>
  );
}
