import { useId, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '@/components/ui';

export interface ShiftsReadOnlyNoticeProps {
  /**
   * The OWNER gets "Renew Premium" (the paywall, context 'shifts'). Managers and
   * members get the plain notice and NO action: a member is never sold a paywall
   * for a circle-level feature (owner-aware gates).
   */
  isOwner: boolean;
  onRenew: () => void;
}

/**
 * Premium lapsed, shifts still on file: they stay visible but nothing can change.
 * Same shape as mobile's `ShiftsReadOnlyNotice` (the canonical one): a dusk-tinted
 * bordered card, an icon tile + copy row, and (owner only) a solid pill below the copy, flush with its left edge. It is a
 * plain labelled group, NOT a live region: it is always there, not an announcement.
 */
export function ShiftsReadOnlyNotice({ isOwner, onRenew }: ShiftsReadOnlyNoticeProps): ReactElement {
  const { t } = useTranslation('shifts');
  const textId = useId();
  return (
    <div
      role="group"
      aria-labelledby={textId}
      data-testid="shifts-readonly-notice"
      className="mb-4 flex flex-col gap-3 rounded-lg border border-dusk bg-dusk-soft p-4"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-cream text-dusk-deep"
        >
          <Icon name="lock-closed-outline" size="inline" />
        </span>
        <p
          id={textId}
          data-testid="shifts-readonly-notice-text"
          className="m-0 min-w-0 flex-1 text-sm font-semibold text-dusk-deep"
        >
          {isOwner ? t('readOnly.owner') : t('readOnly.other')}
        </p>
      </div>
      {isOwner && (
        <button
          type="button"
          onClick={onRenew}
          data-testid="shifts-readonly-renew"
          className="ml-[52px] min-h-[44px] self-start rounded-full bg-dusk px-4 py-2 text-sm font-semibold text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-dusk-deep"
        >
          {t('readOnly.renew')}
        </button>
      )}
    </div>
  );
}
