import { useId, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Icon, Text } from '@/components/ui';
import {
  STATUS_PILL,
  careCardActionPrimary,
  careCardActionSecondary,
} from '@/components/ui/careCard';
import { Analytics } from '@/lib/analytics';
import { resolveHourCycle } from '@/utils/hourCycle';
import { formatTimeDisplay } from '@/utils/timezone';

type DemoState = 'idle' | 'taken' | 'skipped';

/**
 * The live dose demo on the sign-up page (spec 1.3.1 section 6): one sample
 * dose card the visitor can answer, so the product shows what "everyone sees it
 * right away" means before an account exists. Purely local state: nothing is
 * sent anywhere except the anonymous `welcome_demo_interacted` event (enum
 * values only, never the time or any text).
 *
 * Taken reads "Taken · You, {time}"; Skip reads "Skipped" and NEVER "Taken at"
 * (dose status vocabulary). Mobile's WelcomeScreen renders the same card.
 */
export function DoseDemoCard(): ReactElement {
  const { t } = useTranslation('auth');
  const [state, setState] = useState<DemoState>('idle');
  const [answeredAt, setAnsweredAt] = useState('');
  const labelId = useId();

  const answer = (next: 'taken' | 'skipped'): void => {
    const now = new Date();
    setAnsweredAt(formatTimeDisplay(now.getHours(), now.getMinutes(), resolveHourCycle({})));
    setState(next);
    Analytics.welcomeDemoInteracted(next === 'taken' ? 'taken' : 'skip', 'signup');
  };

  const undo = (): void => {
    setState('idle');
    Analytics.welcomeDemoInteracted('undo', 'signup');
  };

  return (
    <Card
      as="section"
      variant="outlined"
      padding="sm"
      aria-labelledby={labelId}
      data-testid="dose-demo-card"
      className="mb-6"
    >
      <div className="flex items-center justify-between gap-3">
        <Text variant="caption" as="h2" id={labelId} className="m-0 font-semibold text-ink-2">
          {t('signup.demo.title')}
        </Text>
        <span className={STATUS_PILL.upcoming}>{t('signup.demo.tryIt')}</span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-full ${
            state === 'taken'
              ? 'bg-moss-soft text-moss-deep'
              : state === 'skipped'
                ? 'bg-line-2 text-ink-2'
                : 'border-2 border-line'
          }`}
        >
          {state === 'taken' && <Icon name="checkmark" size="meta" />}
          {state === 'skipped' && <span>–</span>}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-md font-medium leading-snug text-ink">{t('signup.demo.med')}</p>
          <p className="m-0 text-sm leading-snug text-ink-2">{t('signup.demo.doseLine')}</p>
        </div>
        {state === 'idle' && (
          <div className="flex flex-none items-center gap-1">
            <button type="button" className={careCardActionSecondary} onClick={() => answer('skipped')}>
              {t('signup.demo.skip')}
            </button>
            <button type="button" className={careCardActionPrimary} onClick={() => answer('taken')}>
              {t('signup.demo.taken')}
            </button>
          </div>
        )}
      </div>

      <div aria-live="polite" data-testid="dose-demo-result">
        {state !== 'idle' && (
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-2 pt-3">
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-ink">
                {state === 'taken'
                  ? t('signup.demo.takenLine', { time: answeredAt })
                  : t('signup.demo.skippedLine')}
              </p>
              <p className="m-0 text-sm text-ink-2">{t('signup.demo.seenNote')}</p>
            </div>
            <button
              type="button"
              onClick={undo}
              className="inline-flex min-h-[44px] flex-none items-center px-3 text-sm font-semibold text-moss-deep"
            >
              {t('signup.demo.undo')}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
