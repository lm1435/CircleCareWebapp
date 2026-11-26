import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Eyebrow, Sheet, Text } from '@/components/ui';
import { Analytics } from '@/lib/analytics';
import type { HelperCardAction, HelperCardBody } from '@/lib/todayCoaching';

// The helper's Today card (1.4.4): a plain member (not the owner, a manager or the care recipient) sees ONE
// calm, dismissible card instead of the owner's setup checklist. Facts about the person cared for, never
// about the helper's behaviour; at most one optional action. Mirrors mobile's HelperCard.

export interface HelperCardProps {
  recipientName: string;
  /** 'note' = "Leave a note"; 'care_team' = "See the care team" (view-only: no write action). */
  action: HelperCardAction;
  /** Which sentence is true right now (lib/todayCoaching helperCardBody). */
  bodyKind: HelperCardBody;
  onAction: () => void;
  onDismiss: () => void;
}

export function HelperCard({ recipientName, action, bodyKind, onAction, onDismiss }: HelperCardProps): ReactElement {
  const { t } = useTranslation('overview');

  const title = recipientName
    ? t('today.helperCard.title', { name: recipientName })
    : t('today.helperCard.titleNoName');

  return (
    <Sheet
      role="region"
      aria-labelledby="helper-card-title"
      padding="lg"
      className="rounded-2xl"
      data-testid="helper-card"
    >
      <Eyebrow dot className="block mb-2">
        {t('today.helperCard.eyebrow')}
      </Eyebrow>
      <Text variant="h2" as="h2" id="helper-card-title">
        {title}
      </Text>
      <Text variant="body" className="mt-1.5 max-w-xl text-ink-2">
        {bodyKind === 'busy'
          ? recipientName
            ? t('today.helperCard.bodyBusy', { name: recipientName })
            : t('today.helperCard.bodyBusyNoName')
          : t('today.helperCard.bodyQuiet')}
      </Text>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          data-testid="helper-card-action"
          onClick={() => {
            Analytics.helperTodayCardAction(action);
            onAction();
          }}
        >
          {action === 'note' ? t('today.helperCard.leaveNote') : t('today.helperCard.seeCareTeam')}
        </Button>
        <button
          type="button"
          data-testid="helper-card-dismiss"
          onClick={() => {
            Analytics.helperTodayCardDismissed();
            onDismiss();
          }}
          className="inline-flex min-h-11 items-center px-3 text-md font-semibold text-moss-deep"
        >
          {t('today.helperCard.dismiss')}
        </button>
      </div>
    </Sheet>
  );
}

export default HelperCard;
