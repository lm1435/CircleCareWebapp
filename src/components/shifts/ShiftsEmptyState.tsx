import { HowDoesThisWork } from '@/components/help/HowDoesThisWork';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Button, Card } from '@/components/ui';

export interface ShiftsEmptyStateProps {
  /** Present only for editors; read-only viewers see the copy without the button. */
  onAdd?: () => void;
}

/** Premium circle, no shifts yet: 3 decorative avatars, the pitch, "Add a shift". */
export function ShiftsEmptyState({ onAdd }: ShiftsEmptyStateProps): ReactElement {
  const { t } = useTranslation('shifts');
  return (
    <Card variant="outlined" padding="lg" data-testid="shifts-empty-state">
      <div className="flex flex-col items-center gap-3 text-center">
        <div aria-hidden="true" className="flex -space-x-2">
          <Avatar name="A" size="md" bordered />
          <Avatar name="B" size="md" bordered />
          <Avatar name="C" size="md" bordered />
        </div>
        <h2 className="m-0 font-display text-xl font-medium text-ink">{t('empty.title')}</h2>
        <p className="m-0 max-w-md text-sm text-ink-2">
          {t('empty.description')}
        </p>
        {onAdd && (
          <Button onClick={onAdd} offlineKind="change">
            {t('empty.cta')}
          </Button>
        )}
        <HowDoesThisWork slug="care-shifts" />
      </div>
    </Card>
  );
}
