import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

export interface SpinnerProps {
  /** Accessible label; defaults to the translated "Loading..." */
  label?: string;
  /** Diameter in px */
  size?: number;
  className?: string;
}

/** Accessible loading spinner (no text flash — label is for screen readers). */
export function Spinner({ label, size = 24, className }: SpinnerProps): ReactElement {
  const { t } = useTranslation('common');
  const accessibleLabel = label ?? t('loading');

  return (
    <span
      role="status"
      aria-label={accessibleLabel}
      className={className ? `inline-flex ${className}` : 'inline-flex'}
    >
      <span
        aria-hidden="true"
        className="animate-spin rounded-full border-2 border-line border-t-terracotta-deep"
        style={{ width: size, height: size }}
      />
    </span>
  );
}
