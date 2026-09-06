import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';

export interface WordmarkProps {
  /** Route the lockup links to. Defaults to the circle picker. */
  to?: string;
  /** Extra classes for the link (layout only). */
  className?: string;
  /** Fired after the link is followed (e.g. to close a menu). */
  onClick?: () => void;
}

/**
 * Spec §5.1: the ONE brand lockup — 28×28 app icon + "CircleCare" in `h3`,
 * the word hidden below 640px so the header still fits the circle switcher and
 * the account menu. Used by `Header` and `StandalonePageLayout` (and by
 * `AppLayout` once Task 11 rewrites it), so the brand is drawn in exactly one
 * place instead of three near-copies.
 *
 * "CircleCare" is the product name and is NEVER translated — it is a literal
 * here, not `t('appName')`. The accessible name still comes from i18n so a
 * screen reader announces the link even at the sizes where the word is hidden.
 */
export function Wordmark({ to = '/circles', className, onClick }: WordmarkProps): ReactElement {
  const { t } = useTranslation('common');
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-label={t('appName')}
      // Below `sm` the word is hidden (see the `<Text>` below) and only the
      // 28px icon shows — `min-w-0` let the link shrink to its content, a
      // 36px-wide target short of the WCAG 2.5.5 44px minimum. `min-w-[44px]`
      // floors it there; `sm:min-w-0` lifts the floor once the icon + word
      // together already exceed it. `justify-center` centers the lone icon in
      // the wider box below `sm`; `sm:justify-start` returns to the normal
      // icon-then-word row once the word is showing.
      className={`flex min-h-[44px] min-w-[44px] sm:min-w-0 items-center justify-center sm:justify-start gap-2 px-1 no-underline${
        className ? ` ${className}` : ''
      }`}
    >
      <img src="/icon.png" alt="" className="h-7 w-7 shrink-0 rounded-lg" />
      <Text variant="h3" as="span" className="hidden sm:inline truncate">
        CircleCare
      </Text>
    </Link>
  );
}
