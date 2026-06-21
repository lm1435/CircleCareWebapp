import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Shared required-field indication appended to a field label (WCAG SC 3.3.2 /
 * 3.3.1). Renders a visible asterisk (aria-hidden, color-independent glyph) plus
 * an sr-only "(required)" so assistive tech announces the requirement. The
 * controls themselves still set aria-required separately.
 */
export function RequiredMarker(): ReactElement {
  const { t } = useTranslation('common');
  return (
    <>
      <span aria-hidden="true" className="text-terracotta-deep">
        {' '}
        *
      </span>
      <span className="sr-only"> {t('required')}</span>
    </>
  );
}
