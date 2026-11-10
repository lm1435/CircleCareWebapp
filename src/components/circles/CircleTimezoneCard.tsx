import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { CircleDetail, CircleTimezoneSource } from '@/api/circleMembers';
import { useUpdateCircle } from '@/hooks/useCircleAdmin';
import { Analytics } from '@/lib/analytics';
import { zoneCity } from '@/lib/timezoneOptions';
import { isSameTimezone } from '@/utils/timezone';
import { Card, Icon, useToast } from '@/components/ui';
import { TimezoneCombobox } from './TimezoneCombobox';

// Edit Circle → "Time zone" row (circle-timezone spec, web T11). Owner only:
// EditCirclePage renders it inside its owner branch, and the backend enforces
// owner-only on the PATCH regardless.
//
// Shows the EFFECTIVE zone (`care_recipient_timezone`), where it comes from,
// and — when the owner's choice disagrees with the recipient account's device
// — a one-line hint. Picking a zone saves immediately (mobile's picker does the
// same); "Automatic" saves `timezone: null`.
//
// A Card, never a paper Sheet shell (project rule).

/** Documented last link of the chain (backend `tz_for_scheduling`). */
const DEFAULT_ZONE = 'America/New_York';

export interface CircleTimezoneCardProps {
  circleId: string;
  circle: CircleDetail;
}

/** Older backends omit `circle_timezone_source`: derive it from what they do send. */
export function resolveTimezoneSource(
  circle: CircleDetail,
  recipientZone: string | null
): CircleTimezoneSource {
  if (circle.circle_timezone_source) return circle.circle_timezone_source;
  if (circle.circle_timezone) return 'circle';
  return recipientZone ? 'recipient' : 'owner';
}

export function CircleTimezoneCard({ circleId, circle }: CircleTimezoneCardProps): ReactElement {
  const { t } = useTranslation('circles');
  const { showToast } = useToast();
  const update = useUpdateCircle(circleId);

  const name = circle.recipient_name;
  const effective = circle.care_recipient_timezone || DEFAULT_ZONE;
  const override = circle.circle_timezone ?? null;
  const recipientZone = circle.members.find((m) => m.is_care_recipient)?.timezone ?? null;
  const ownerZone = circle.members.find((m) => m.id === circle.owner_id)?.timezone ?? null;
  const source = resolveTimezoneSource(circle, recipientZone);
  /** What "Automatic" resolves to right now (recipient → owner → default). */
  const automaticZone = recipientZone ?? ownerZone ?? DEFAULT_ZONE;

  const sourceText =
    source === 'circle'
      ? t('timezone.sourceCircle')
      : source === 'recipient'
        ? t('timezone.sourceRecipient', { name })
        : t('timezone.sourceOwner');

  const showMismatch = !!override && !!recipientZone && !isSameTimezone(recipientZone, override);

  const ids = {
    source: 'circle-timezone-source',
    helper: 'circle-timezone-helper',
    note: 'circle-timezone-note',
    mismatch: 'circle-timezone-mismatch',
  };
  const describedBy = [ids.source, ids.helper, ids.note, showMismatch ? ids.mismatch : null]
    .filter(Boolean)
    .join(' ');

  const handleSelect = (zone: string | null): void => {
    // Re-picking the current choice is not a change.
    if (zone === null ? override === null : isSameTimezone(zone, override)) return;
    if (update.isPending) return;
    update.mutate(
      { timezone: zone },
      {
        onSuccess: () => {
          try {
            Analytics.circleTimezoneSet({
              source: 'edit_circle',
              cleared: zone === null,
              // Cleared: the zone automatic now resolves to (recipient → owner → default).
              zone: zone ?? automaticZone,
              recipient_zone_mismatch:
                zone !== null && !!recipientZone && !isSameTimezone(recipientZone, zone),
            });
          } catch {
            // Analytics must never cost the owner the save.
          }
          showToast(t('edit.savedToast'), 'success');
        },
      }
    );
  };

  return (
    <Card padding="lg" className="mx-5 mt-4" data-testid="circle-timezone-card">
      <TimezoneCombobox
        id="circle_timezone"
        label={t('timezone.label')}
        displayZone={effective}
        selected={override}
        automaticOption={{
          label: t('timezone.automatic'),
          // Automatic follows the recipient account's device when there is one,
          // otherwise the owner's (this page is owner-only, so "your device").
          hint: recipientZone
            ? t('timezone.automaticRecipient', { name, city: zoneCity(recipientZone) })
            : t('timezone.automaticOwn', { city: zoneCity(automaticZone) }),
        }}
        onSelect={handleSelect}
        describedBy={describedBy}
        busy={update.isPending}
        testId="circle-timezone-combobox"
      />
      <p id={ids.source} data-testid="circle-timezone-source" className="m-0 mt-2 text-sm font-medium text-ink-2">
        {sourceText}
      </p>
      <p id={ids.helper} className="m-0 mt-1 text-sm text-ink-3">
        {t('timezone.helper')}
      </p>
      <p id={ids.note} className="m-0 mt-1 text-sm text-ink-3">
        {t('timezone.wallClockNote')}
      </p>
      {showMismatch && recipientZone && override ? (
        <p
          id={ids.mismatch}
          data-testid="circle-timezone-mismatch"
          className="m-0 mt-3 flex items-start gap-2 text-sm text-ink-2"
        >
          <Icon name="alert-circle-outline" size="inline" className="mt-0.5 shrink-0 text-ink-2" />
          <span>
            {t('timezone.mismatch', {
              name,
              city: zoneCity(recipientZone),
              setCity: zoneCity(override),
            })}
          </span>
        </p>
      ) : null}
    </Card>
  );
}
