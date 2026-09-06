import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconTile, SectionHeader, Sheet, SheetRowPressable } from '@/components/ui';

// Spec §6.3.10 — port of mobile CircleDetailScreen's settings Sheet
// (CircleDetailScreen.tsx:1615-1660): Edit circle, Members, Delete circle,
// each 52 tall with a 36 IconTile and a trailing chevron.

export interface SettingsRowsProps {
  circleId: string;
  /** Only owners can delete a circle — the backend rejects anyone else. */
  isOwner: boolean;
}

/**
 * The "Manage" rows at the foot of Home.
 *
 * DELETE NAVIGATES rather than opening a dialog here. The type-to-confirm
 * delete flow already lives on the settings page (`EditCirclePage`, spec
 * §6.7), and a destructive confirmation with two different implementations is
 * two things to keep in agreement. The row carries the terracotta treatment so
 * it still reads as the destructive one before you arrive.
 */
export function SettingsRows({ circleId, isOwner }: SettingsRowsProps): ReactElement {
  const { t } = useTranslation('overview');
  const base = `/circles/${circleId}`;

  return (
    <section aria-labelledby="circle-settings-heading">
      <SectionHeader id="circle-settings-heading" title={t('settings.title')} tone="moss" />
      <Sheet padding="none" className="overflow-hidden">
        <SheetRowPressable to={`${base}/settings`} className="min-h-[52px]">
          <IconTile size={36} tone="neutral" name="settings-outline" />
          <span className="min-w-0 flex-1 text-md font-medium text-ink">
            {t('settings.editCircle')}
          </span>
          <Icon name="chevron-forward" size="inline" className="text-ink-3" />
        </SheetRowPressable>

        <SheetRowPressable to={`${base}/members`} className="min-h-[52px]">
          <IconTile size={36} tone="neutral" name="people-outline" />
          <span className="min-w-0 flex-1 text-md font-medium text-ink">
            {t('settings.members')}
          </span>
          <Icon name="chevron-forward" size="inline" className="text-ink-3" />
        </SheetRowPressable>

        {isOwner ? (
          <SheetRowPressable to={`${base}/settings#danger`} className="min-h-[52px]">
            <IconTile size={36} tone="terracotta" name="trash-outline" />
            <span className="min-w-0 flex-1 text-md font-medium text-terracotta-deep">
              {t('settings.deleteCircle')}
            </span>
            <Icon name="chevron-forward" size="inline" className="text-terracotta-deep" />
          </SheetRowPressable>
        ) : null}
      </Sheet>
    </section>
  );
}

export default SettingsRows;
