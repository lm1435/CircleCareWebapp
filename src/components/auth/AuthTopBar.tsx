import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleButton, Eyebrow } from '@/components/ui';

export interface AuthTopBarProps {
  /** Renders the back button and wires this handler. Omit to render a spacer. */
  onBack?: () => void;
}

/**
 * Shared top bar for every signed-out screen (mirrors mobile's `AuthTopBar` in
 * `mobile/src/screens/auth/authChrome.tsx`): a round back button (or a
 * same-width spacer, so the masthead stays optically centered), the
 * "• CIRCLECARE" masthead, and a balancing spacer on the right.
 *
 * The brand label is never translated.
 */
export function AuthTopBar({ onBack }: AuthTopBarProps): ReactElement {
  const { t } = useTranslation('common');

  return (
    <div className="mb-7 flex items-center justify-between">
      {onBack ? (
        <CircleButton name="arrow-back" label={t('nav.back')} shadow={false} onClick={onBack} />
      ) : (
        <div className="w-11" aria-hidden="true" />
      )}

      <Eyebrow dot color="clay" className="tracking-[2px]">
        CIRCLECARE
      </Eyebrow>

      <div className="w-11" aria-hidden="true" />
    </div>
  );
}
