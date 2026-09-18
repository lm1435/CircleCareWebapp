import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Text } from '@/components/ui';
import { formatFileSize } from './formatFileSize';

export interface StorageBarProps {
  usedBytes: number;
  limitBytes: number;
  /** Called by the Upgrade button at 100%+ usage. Owner-only affordance. */
  onUpgrade?: () => void;
  /** Circle owner — the only person the Upgrade button is offered to. */
  isOwner?: boolean;
  /**
   * The circle owner's first name, for a NON-owner's full message ("Only Ana,
   * the circle owner, can upgrade for more space."). Storage is the OWNER's
   * tier, so a non-owner is told who can lift it, never to upgrade themselves.
   * Omitted/unknown -> the nameless copy.
   */
  ownerName?: string;
  /**
   * The circle is on the FREE storage cap (200MB) -- the only case an upgrade
   * raises it. A premium circle at its 1GB cap has no bigger plan, so nobody
   * is offered Upgrade and the copy says the only remedy: delete files.
   * Derived from the server's circle-level `storage.limit` (the OWNER's tier),
   * not `is_premium_circle`, which is per-membership and false for a view-only
   * seat even when the owner pays. Defaults to true (the free-tier behavior).
   */
  isFreeTier?: boolean;
}

/** `<80` is unreachable from this component (see the early return below) but
 * kept as a real branch so the mapping stays total and testable on its own. */
function trackFillClass(pct: number): string {
  if (pct >= 100) return 'bg-terracotta';
  if (pct >= 80) return 'bg-clay';
  return 'bg-moss';
}

/**
 * Storage usage indicator for the Documents page (spec §6.6; mobile
 * `StorageUsageBar`). Stays out of the way below 80% usage — only a plain
 * caption footnote renders — and becomes a visual bar (clay, then terracotta
 * at 100%) only once storage is actually something to look at.
 */
export function StorageBar({
  usedBytes,
  limitBytes,
  onUpgrade,
  isOwner = false,
  ownerName,
  isFreeTier = true,
}: StorageBarProps): ReactElement {
  const { t } = useTranslation('documents');
  const pct = limitBytes > 0 ? (usedBytes / limitBytes) * 100 : 0;
  const remainingBytes = Math.max(0, limitBytes - usedBytes);
  const usedLabel = formatFileSize(usedBytes);
  const limitLabel = formatFileSize(limitBytes);
  const remainingLabel = formatFileSize(remainingBytes);

  if (pct < 80) {
    return <Text variant="caption">{t('storage.footnote', { used: usedLabel, limit: limitLabel })}</Text>;
  }

  const isFull = pct >= 100;

  return (
    <div>
      <div className="flex justify-between">
        <Text variant="caption">{t('storage.used', { used: usedLabel })}</Text>
        <Text variant="caption">{t('storage.remaining', { remaining: remainingLabel })}</Text>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(pct, 100))}
        aria-label={t('storage.trackLabel')}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-[3px] bg-moss-soft"
      >
        <div
          className={`h-1.5 rounded-[3px] ${trackFillClass(pct)}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {isFull && (
        <div className="mt-2 flex items-center justify-between gap-3">
          {/* terracotta-DEEP: base terracotta is never text on the web (ADA);
              deep is 7.29:1 on the page background, 7.67:1 on white. */}
          <span className="flex items-center gap-1.5 text-xs text-terracotta-deep">
            <Icon name="alert-circle-outline" size="inline" className="text-terracotta-deep" />
            {!isFreeTier
              ? t('storage.fullPremium')
              : isOwner
                ? t('storage.full')
                : ownerName
                  ? t('storage.fullNonOwnerNamed', { ownerName })
                  : t('storage.fullNonOwner')}
          </span>
          {isOwner && isFreeTier && (
            <Button variant="primary" size="sm" className="min-h-[32px]!" onClick={onUpgrade}>
              {t('storage.upgrade')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
