import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Text } from '@/components/ui';
import { Analytics } from '@/lib/analytics';

export interface SosCardProps {
  /** The verified local emergency number (lib/emergencyNumber.ts). */
  number: string;
}

/**
 * The SOS card at the top of Emergency info (1.4.3, mobile parity: EmergencyInfoScreen's
 * `sos-card-dial`). Invariant terracotta (`sos` tokens, same in light and dark, as mobile's
 * `th.sos`): the one place the emergency red is the whole surface.
 *
 * THE NUMBER IS ALWAYS VISIBLE AS TEXT, large and selectable: `tel:` does nothing on most
 * desktops, so the card can never be only a link. The call button beside it is the `tel:` link
 * (a phone or a desktop with a calling app dials it). The caller renders nothing when the
 * browser's region has no verified number: never a guessed number.
 */
export function SosCard({ number }: SosCardProps): ReactElement {
  const { t } = useTranslation('emergency');
  const dial = t('sos.dial', { number });
  return (
    <div
      data-testid="sos-card"
      className="sos-card flex items-center justify-between gap-4 rounded-xl bg-sos px-5 py-4"
    >
      <div className="min-w-0">
        <Text variant="mono" as="p" className="text-on-sos-soft! uppercase">
          {t('sos.tapToCall')}
        </Text>
        <Text
          variant="sheetTitle"
          as="p"
          data-testid="sos-number"
          className="select-text text-on-sos!"
        >
          {dial}
        </Text>
      </div>
      <a
        href={`tel:${number}`}
        aria-label={dial}
        data-testid="sos-card-dial"
        onClick={() => Analytics.emergencySosDialTapped()}
        className="no-print inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-sos-chip-line bg-sos-chip text-on-sos focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-sos"
      >
        <Icon name="call-outline" size="chrome" />
      </a>
    </div>
  );
}
