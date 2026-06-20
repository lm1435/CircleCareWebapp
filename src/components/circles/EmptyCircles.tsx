import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, EmptyState } from '@/components/ui';
import { CirclesIcon } from '@/components/ui/emptyStateIcons';
import { StoreBadges } from '@/components/layout/StoreBadges';

/**
 * Empty state for the circle picker (plan edge case: user has no circles).
 * Icon tile + heading + body + store download CTA, mirroring mobile's rich
 * empty states.
 */
export function EmptyCircles(): ReactElement {
  const { t } = useTranslation('members');

  return (
    <Card className="mx-auto mt-8 max-w-lg p-8">
      <EmptyState
        tone="moss"
        icon={<CirclesIcon />}
        title={t('picker.empty.title')}
        description={t('picker.empty.body')}
      >
        <StoreBadges layout="row" className="justify-center" />
      </EmptyState>
    </Card>
  );
}
