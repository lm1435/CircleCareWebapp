import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';
import { CirclesIcon } from '@/components/ui/emptyStateIcons';
import { StoreBadges } from '@/components/layout/StoreBadges';

export interface EmptyCirclesProps {
  /** The create-circle CTA (web can create circles; this is the primary action). */
  action?: ReactNode;
}

/**
 * Premium empty state for the circle picker (user has no circles yet). Bespoke
 * layout (not the generic EmptyState) for a richer, more considered first-run
 * moment: a refined icon, a serif headline, an editorial "how it works" card
 * with serif step numerals, the primary Create-circle CTA, and the mobile app
 * positioned as an optional companion below a hairline divider.
 */
export function EmptyCircles({ action }: EmptyCirclesProps): ReactElement {
  const { t } = useTranslation('members');
  const steps = [
    t('picker.empty.step1'),
    t('picker.empty.step2'),
    t('picker.empty.step3'),
  ];

  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 sm:p-10">
      <div className="flex flex-col items-center text-center">
        {/* Icon */}
        <span
          aria-hidden="true"
          className="flex h-16 w-16 items-center justify-center rounded-[20px] bg-moss-soft text-moss-deep"
        >
          <CirclesIcon size={30} />
        </span>

        {/* Headline + body */}
        <h2 className="serif m-0 mt-6 text-2xl leading-tight text-ink">
          {t('picker.empty.title')}
        </h2>
        <p className="m-0 mt-2 max-w-sm text-ink-3">{t('picker.empty.body')}</p>

        {/* How it works — editorial card */}
        <div className="mt-8 w-full rounded-2xl border border-line bg-cream p-6 text-left">
          <p className="eyebrow m-0">{t('picker.empty.howItWorksTitle')}</p>
          <ol className="m-0 mt-5 flex list-none flex-col gap-5 p-0">
            {steps.map((step, i) => (
              <li key={step} className="flex items-center gap-4">
                <span
                  aria-hidden="true"
                  className="serif flex h-8 w-8 flex-none items-center justify-center rounded-full bg-moss-soft text-base text-moss-deep"
                >
                  {i + 1}
                </span>
                <span className="text-sm leading-snug text-ink-2">{step}</span>
              </li>
            ))}
          </ol>
          <Link
            to="/help"
            className="mt-5 inline-block text-sm font-medium text-terracotta-deep underline-offset-4 hover:underline"
          >
            {t('picker.empty.learnMore')}
          </Link>
        </div>

        {/* Primary action */}
        {action ? <div className="mt-8">{action}</div> : null}

        {/* Companion app — secondary, below a hairline divider */}
        <div className="mt-8 w-full border-t border-line-2 pt-6">
          <p className="m-0 text-sm text-ink-3">{t('picker.empty.companion')}</p>
          <div className="mt-3 flex justify-center">
            <StoreBadges layout="row" />
          </div>
        </div>
      </div>
    </Card>
  );
}
