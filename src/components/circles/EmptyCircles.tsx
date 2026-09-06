import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, Eyebrow, Icon, Text } from '@/components/ui';
import { StoreBadges } from '@/components/layout/StoreBadges';

export interface EmptyCirclesProps {
  /** The create-circle CTA (web can create circles; this is the primary action). */
  action?: ReactNode;
  /** Secondary "join with an invite code" CTA, for users invited by family. */
  joinAction?: ReactNode;
}

/**
 * Empty state for the circle picker (user has no circles yet). Spec §6.2: a
 * moss icon tile, an `h2` headline, three numbered "how it works" steps, the
 * primary Create-circle CTA, and the mobile app positioned as an optional
 * companion below a hairline divider.
 */
export function EmptyCircles({ action, joinAction }: EmptyCirclesProps): ReactElement {
  const { t } = useTranslation('members');
  const steps = [
    t('picker.empty.step1'),
    t('picker.empty.step2'),
    t('picker.empty.step3'),
  ];

  return (
    <Card variant="elevated" padding="lg" className="mx-auto mt-10 max-w-lg">
      <div className="flex flex-col items-center text-center">
        {/* Icon */}
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-xl bg-moss-soft"
        >
          <Icon name="people-outline" size="chrome" className="text-moss" />
        </span>

        {/* Headline + body */}
        <Text variant="h2" as="h2" className="mt-6">
          {t('picker.empty.title')}
        </Text>
        <Text variant="caption" className="mt-2 max-w-sm">
          {t('picker.empty.body')}
        </Text>

        {/* How it works */}
        <div className="mt-8 w-full text-left">
          <Eyebrow>{t('picker.empty.howItWorksTitle')}</Eyebrow>
          <ol className="m-0 mt-5 flex list-none flex-col gap-5 p-0">
            {steps.map((step, i) => (
              <li key={step} className="flex items-center gap-4">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-moss-soft text-sm font-semibold text-moss-deep"
                >
                  {i + 1}
                </span>
                <span className="text-sm leading-snug text-ink-2">{step}</span>
              </li>
            ))}
          </ol>
          <Link
            to="/help"
            className="mt-5 inline-block text-sm font-medium text-coral-deep underline-offset-4 hover:underline"
          >
            {t('picker.empty.learnMore')}
          </Link>
        </div>

        {/* Primary action */}
        {action ? <div className="mt-8">{action}</div> : null}

        {/* Secondary action — join an existing circle by invite code */}
        {joinAction ? <div className="mt-4">{joinAction}</div> : null}

        {/* Already invited by email — point at the pending-invitations page */}
        <p className="m-0 mt-4 text-sm text-ink-3">
          {t('picker.empty.invitedHintPrefix')}{' '}
          <Link
            to="/invites"
            className="font-medium text-coral-deep underline-offset-4 hover:underline"
          >
            {t('picker.empty.invitedHintLink')}
          </Link>
        </p>

        {/* Hairline divider */}
        <div aria-hidden="true" className="w-full border-t border-line-2 my-6" />

        {/* Companion app — secondary, below the hairline */}
        <div className="w-full">
          <p className="m-0 text-sm text-ink-3">{t('picker.empty.companion')}</p>
          <div className="mt-3 flex justify-center">
            <StoreBadges layout="row" />
          </div>
        </div>
      </div>
    </Card>
  );
}
