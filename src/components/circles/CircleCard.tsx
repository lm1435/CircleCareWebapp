import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Card, Icon, Skeleton, Text } from '@/components/ui';
import type { Circle } from '@/api/circles';
import { useMedicationTodaySummary } from '@/hooks/useMedConfirmation';
import { Analytics } from '@/lib/analytics';

export interface CircleCardProps {
  circle: Circle;
}

type RoleKey = 'owner' | 'caregiver' | 'careRecipient';

// Soft status-dot tint on the avatar, by role (mirrors mobile's accent dot).
// Care-recipient identity uses coral (warmth/identity), never terracotta
// (reserved for danger/alarm — see the overdue alert badge below).
const roleDotClass: Record<RoleKey, string> = {
  owner: 'bg-moss',
  careRecipient: 'bg-coral',
  caregiver: 'bg-dusk',
};

// Mirrors mobile's ownerBadgeSmall / careRecipientBadgeSmall / memberBadgeSmall
// (CircleListScreen.tsx) — same rounded-sm / px-2 / py-0.5 shape, one bg/text
// pair per role.
const roleBadgeClass: Record<RoleKey, string> = {
  owner: 'rounded-sm bg-moss-wash px-2 py-0.5 text-xs font-semibold text-moss-deep',
  careRecipient: 'rounded-sm bg-clay-soft px-2 py-0.5 text-xs font-semibold text-clay-deep',
  caregiver: 'rounded-sm bg-bg-2 px-2 py-0.5 text-xs font-semibold text-ink-2',
};

function getRoleKey(circle: Circle): RoleKey {
  if (circle.is_care_recipient) return 'careRecipient';
  return circle.role === 'owner' ? 'owner' : 'caregiver';
}

/** Bold "!" alert badge only; the row below never needs its own overdue tone —
 *  mobile's `statusRow`/`statusText` styles just distinguish all-taken
 *  (moss `checkmark-circle`) from everything else (ink-3 `medkit-outline`). */
type MedRowIcon = 'checkmark-circle' | 'medkit-outline';

/**
 * Circle picker card (spec §6.2, mobile parity with CircleListScreen's compact
 * card — the picker only ever renders when there are 2+ circles, since a
 * single circle auto-skips straight to its overview, so the richer "hero"
 * card mobile shows for exactly one circle has no web equivalent here).
 *
 * The whole card is a link to the circle's overview. Non-restricted circles
 * get a medication-status row (mirrors mobile's `statusRow`/`statusText`) with
 * the role badge (owner / care recipient / caregiver) on its right, and, when
 * today's medications are overdue, a small alert badge on the avatar (mirrors
 * mobile's MedicationAlertIndicator — shown even on the compact card).
 * Restricted circles (`read_only` / `view_only`) show their access badge next
 * to the name instead, skip the meds fetch entirely, and are visually
 * subdued.
 */
export function CircleCard({ circle }: CircleCardProps): ReactElement {
  const { t } = useTranslation('members');

  const isReadOnly = Boolean(circle.read_only);
  const isViewOnly = circle.view_only;
  const restricted = isReadOnly || isViewOnly;
  const roleKey = getRoleKey(circle);

  // Only fetch meds for circles the user can actually act on (passing undefined
  // disables the query — see useMedicationTodaySummary's `enabled`).
  const { data: summary, isPending: medsPending } = useMedicationTodaySummary(
    restricted ? undefined : circle.id
  );
  const overdueCount = summary ? Math.max(summary.overdue, summary.not_marked_total) : 0;
  const hasOverdueAlert = !restricted && overdueCount > 0;

  // Mirrors mobile's MedicationSnapshotRow precedence: no meds today → all
  // taken → still some left (including overdue — the small avatar badge above
  // already carries that distinction, so the row's own icon/tone stays plain).
  const allTaken = summary ? summary.total_today > 0 && summary.taken >= summary.total_today : false;
  const medRowIcon: MedRowIcon = allTaken ? 'checkmark-circle' : 'medkit-outline';
  const medRowLabel = !summary
    ? null
    : summary.total_today === 0
      ? t('med.noMedsToday')
      : allTaken
        ? t('med.allTaken')
        : t('med.takenToday', { taken: summary.taken, total: summary.total_today });

  // Care-first subtitle. Restricted access copy takes precedence, then the
  // care-recipient "people helping" phrasing, else "caring for {recipient}".
  const subtitle = isReadOnly
    ? circle.role === 'owner'
      ? t('access.readOnlyOwnerSubtitle')
      : t('access.readOnlyMemberSubtitle')
    : isViewOnly
      ? t('access.viewOnlySubtitle')
      : circle.is_care_recipient
        ? t('picker.personHelping', { count: circle.member_count })
        : t('picker.caringWith', { count: circle.member_count });

  // The whole card is ONE link, and `aria-label` REPLACES its accessible name
  // wholesale — a screen reader landing on it via Tab announces only this
  // string, never the visible descendant text (the name, the med row, the
  // access badge). So everything a sighted user reads on the card has to be
  // composed into `cardLabel` by hand; nothing here is "extra".
  //
  // The role status dot and the overdue alert badge are ALSO color-only +
  // aria-hidden (WCAG SC 1.1.1 / 1.4.1) — when overdue, `picker.openWithRoleOverdue`
  // already folds a full taken/total/overdue sentence in, so that branch is
  // self-contained; the plain branch appends whichever single line the card
  // itself shows below the name (the access badge's word when restricted,
  // else the med-row's label) with a comma, mirroring how the visible card
  // reads top to bottom.
  const roleLabel = t(`roles.${roleKey}`);
  const restrictedLabel = isReadOnly
    ? t('access.readOnly')
    : isViewOnly
      ? t('access.viewOnly')
      : null;
  const cardLabel = hasOverdueAlert
    ? t('picker.openWithRoleOverdue', {
        name: circle.name,
        role: roleLabel,
        status: t('med.takenOverdue', {
          taken: summary?.taken ?? 0,
          total: summary?.total_today ?? 0,
          overdue: overdueCount,
        }),
      })
    : [
        t('picker.openWithRole', { name: circle.name, role: roleLabel }),
        restricted ? restrictedLabel : medRowLabel,
      ]
        .filter(Boolean)
        .join(', ');

  return (
    <li className="list-none">
      <Link
        to={`/circles/${circle.id}`}
        aria-label={cardLabel}
        onClick={() => Analytics.circleViewed(circle.id)}
        data-restricted={restricted || undefined}
        className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss-deep"
      >
        <Card
          variant="elevated"
          padding="none"
          className={
            restricted
              ? 'border-[1.5px] border-dashed border-line-2 bg-bg!'
              : 'border-[1.5px] border-line-2'
          }
        >
          <div className={`p-3${restricted ? ' opacity-70' : ''}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="relative shrink-0">
                  <Avatar
                    size="md"
                    bordered
                    name={circle.recipient_name}
                    photoUrl={circle.recipient_photo_url}
                  />
                  {/* Role status dot — neutral `bg-bg-3` when restricted (the
                      role itself stops being the salient fact once access is
                      capped), the role's own tint otherwise. */}
                  <span
                    aria-hidden="true"
                    className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full ring-2 ring-cream ${restricted ? 'bg-bg-3' : roleDotClass[roleKey]}`}
                  />
                  {/* Overdue alert badge — solid deep-terracotta disc with a bold
                      "!" (the badge IS the alert, so no separate icon glyph). */}
                  {hasOverdueAlert && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-cream bg-terracotta-deep text-xs font-bold text-cream shadow-sm"
                    >
                      !
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="m-0 line-clamp-2 break-words text-md font-semibold text-ink">
                      {circle.name}
                    </p>
                    {restricted &&
                      (isReadOnly ? (
                        <span className="inline-flex items-center gap-0.5 rounded-sm bg-dusk-soft px-2 py-0.5 text-xs font-semibold text-dusk">
                          <Icon name="lock-closed-outline" size={12} />
                          {t('access.readOnly')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 rounded-sm bg-bg-2 px-2 py-0.5 text-xs font-semibold text-ink-2">
                          <Icon name="eye-outline" size={12} />
                          {t('access.viewOnly')}
                        </span>
                      ))}
                  </div>
                  <Text variant="caption" className="mt-0.5 truncate">
                    {subtitle}
                  </Text>
                </div>
              </div>

              <Icon name="chevron-forward" size="inline" className="shrink-0 text-ink-3" />
            </div>

            {/* Medication-status row (mobile's MedicationSnapshotRow) — only
                for circles the user can act on; restricted cards never fetch
                a summary at all. */}
            {!restricted && (
              <div className="mt-3 flex items-center justify-between border-t border-line-2 pt-3">
                <span className="flex items-center gap-2 text-sm text-ink-2">
                  {medsPending && !summary ? (
                    <Skeleton className="h-4 w-32" />
                  ) : (
                    <>
                      <Icon
                        name={medRowIcon}
                        size="inline"
                        className={allTaken ? 'text-moss' : 'text-ink-3'}
                      />
                      {medRowLabel}
                    </>
                  )}
                </span>
                <span className={roleBadgeClass[roleKey]}>{roleLabel}</span>
              </div>
            )}
          </div>
        </Card>
      </Link>
    </li>
  );
}
