import { useEffect, type ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Eyebrow } from '@/components/ui';
import { Analytics } from '@/lib/analytics';

// The one-time first-dose hint (docs/plans/simple-ui-1-3-1.md "Coaching (c)";
// hi-fi HiHint), drawn under the first dose row. Persisted per user so it
// never shows twice.

export interface DoseHintProps {
  recipientName: string;
  isSelfCare: boolean;
  onGotIt: () => void;
}

export function DoseHint({ recipientName, isSelfCare, onGotIt }: DoseHintProps): ReactElement {
  const { t } = useTranslation('overview');
  useEffect(() => {
    Analytics.coachingHintShown('first_dose');
  }, []);
  const self = isSelfCare || !recipientName;

  return (
    <div
      role="note"
      data-testid="dose-hint"
      className="rounded-xl bg-moss-soft px-4 py-3"
    >
      <Eyebrow deep color="moss" className="mb-1">
        {t('today.doseHint.eyebrow')}
      </Eyebrow>
      <p className="m-0 text-md text-ink">
        {self ? (
          <Trans
            t={t}
            i18nKey="today.doseHint.bodySelf"
            components={{ b: <strong className="font-semibold" /> }}
          />
        ) : (
          <Trans
            t={t}
            i18nKey="today.doseHint.body"
            values={{ name: recipientName }}
            components={{ b: <strong className="font-semibold" /> }}
          />
        )}
      </p>
      <button
        type="button"
        onClick={() => {
          Analytics.coachingHintDismissed('first_dose');
          onGotIt();
        }}
        className="mt-1 inline-flex min-h-11 items-center text-md font-semibold text-moss-deep"
      >
        {t('today.doseHint.gotIt')}
      </button>
    </div>
  );
}

export default DoseHint;
