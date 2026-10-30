import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Eyebrow, Sheet, Text } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import type { NextStepKey } from '@/lib/todayCoaching';

// The next-step card (docs/plans/simple-ui-1-3-1.md; hi-fi HiTodayNew). It
// replaces the getting-started checklist and the "Watch how it works" card:
// ONE step at a time, one button, "Not now" (hides the step for 3 days).
// Copy never assumes relatives.

export interface NextStepCardProps {
  step: NextStepKey;
  /** 1-based position among the steps this viewer can do, and how many there are. */
  position: number;
  total: number;
  recipientName: string;
  isSelfCare: boolean;
  onAction: () => void;
  onNotNow: () => void;
}

export function NextStepCard({
  step,
  position,
  total,
  recipientName,
  isSelfCare,
  onAction,
  onNotNow,
}: NextStepCardProps): ReactElement {
  const { t } = useTranslation('overview');

  // Shown: once per step per mount of the card.
  useEffect(() => {
    Analytics.nextStepShown(step);
  }, [step]);

  const self = isSelfCare || !recipientName;
  const params = { name: recipientName };
  // Literal keys on purpose (no `${step}` interpolation): the translation-key
  // audit can then see every one of them.
  const copy = {
    first_med: {
      title: self ? t('today.nextStep.first_med.titleSelf') : t('today.nextStep.first_med.title', params),
      body: self ? t('today.nextStep.first_med.bodySelf') : t('today.nextStep.first_med.body', params),
      cta: t('today.nextStep.first_med.cta'),
    },
    invite: {
      title: self ? t('today.nextStep.invite.titleSelf') : t('today.nextStep.invite.title', params),
      body: self ? t('today.nextStep.invite.bodySelf') : t('today.nextStep.invite.body', params),
      cta: t('today.nextStep.invite.cta'),
    },
    reminders: {
      title: self ? t('today.nextStep.reminders.titleSelf') : t('today.nextStep.reminders.title', params),
      body: self ? t('today.nextStep.reminders.bodySelf') : t('today.nextStep.reminders.body', params),
      cta: t('today.nextStep.reminders.cta'),
    },
  }[step];

  return (
    <Sheet
      role="region"
      aria-labelledby="next-step-title"
      padding="lg"
      className="rounded-2xl"
      data-testid="next-step-card"
      data-step={step}
    >
      <Eyebrow dot deep color="moss" className="mb-2">
        {t('today.nextStep.eyebrow', { current: position, total })}
      </Eyebrow>
      <Text variant="h2" as="h2" id="next-step-title">
        {copy.title}
      </Text>
      <Text variant="body" className="mt-1.5 max-w-xl text-ink-2">
        {copy.body}
      </Text>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            Analytics.nextStepTapped(step);
            onAction();
          }}
        >
          {copy.cta}
        </Button>
        <button
          type="button"
          onClick={() => {
            Analytics.nextStepDismissed(step);
            onNotNow();
          }}
          className="inline-flex min-h-11 items-center px-3 text-md font-semibold text-moss-deep"
        >
          {t('today.notNow')}
        </button>
      </div>
    </Sheet>
  );
}

export default NextStepCard;
