import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Card, Icon, Skeleton, Text, type IconName } from '@/components/ui';
import type { Circle } from '@/api/circles';
import { useMedicationTodaySummary } from '@/hooks/useMedConfirmation';
import { useLatestActivity } from '@/hooks/useActivityFeed';
import { useHourCycle } from '@/hooks/useHourCycle';
import { getActivityIcon } from '@/components/activity/ActivityIcon';
import { renderActivityDescription } from '@/components/activity/activityTranslation';
import { formatRelativeTime } from '@/components/activity/activityFormat';
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

/**
 * The action types the status line REFUSES to report.
 *
 * Practically every circle has a `circle_created` row, and it is the OLDEST
 * one there is — so for a circle where nothing has happened since, "Created
 * Care Circle for Rose · 3w ago" is what the card would say forever. That is
 * a worse line than admitting nothing has been tracked yet: it names an act
 * of setup as if it were care, and it never changes. Skipping it lets the
 * card fall through to the honest empty line instead.
 */
const NON_ACTIVITY_TYPES = new Set(['circle_created']);

/**
 * Circle picker card (spec §6.2, mobile parity with CircleListScreen's compact
 * card — the picker only ever renders when there are 2+ circles, since a
 * single circle auto-skips straight to its overview, so the richer "hero"
 * card mobile shows for exactly one circle has no web equivalent here).
 *
 * The whole card is a link to the circle's overview. Non-restricted circles
 * get a STATUS row (mirrors mobile's `statusRow`/`statusText`) with the role
 * badge (owner / care recipient / caregiver) on its right, and, when today's
 * medications are overdue, a small alert badge on the avatar (mirrors mobile's
 * MedicationAlertIndicator — shown even on the compact card). Restricted
 * circles (`read_only` / `view_only`) show their access badge next to the name
 * instead, skip BOTH fetches entirely, and are visually subdued.
 */
export function CircleCard({ circle }: CircleCardProps): ReactElement {
  const { t } = useTranslation('members');
  // A SECOND, SEPARATELY BOUND `t`, not a `useTranslation(['members',
  // 'activity'])` array. The activity renderers below are handed a `t` and
  // call it with bare keys (`phrases.completedTask`, `time.daysAgo`) that live
  // in `activity`; a `t` bound to a namespace ARRAY resolves those against the
  // FIRST namespace only and returns the raw key string on a miss, which put
  // "phrases.completedTask Groceries · time.daysAgo" on the card. Same shape
  // ActivityItem/LatestHero use.
  const { t: tActivity } = useTranslation('activity');
  const hourCycle = useHourCycle();

  const isReadOnly = Boolean(circle.read_only);
  const isViewOnly = circle.view_only;
  const restricted = isReadOnly || isViewOnly;
  const roleKey = getRoleKey(circle);

  // Only fetch meds for circles the user can actually act on (passing undefined
  // disables the query — see useMedicationTodaySummary's `enabled`).
  const { data: summary, isPending: medsPending } = useMedicationTodaySummary(
    restricted ? undefined : circle.id
  );
  // Same gate, same reason: a restricted card renders no status row at all, so
  // it must not pay for either request. `useLatestActivity` is the 3-row
  // useQuery twin of the feed's useInfiniteQuery — see the hook's own comment
  // for why the page-of-30 hook is the wrong tool on a card.
  const { data: latest, isPending: activityPending } = useLatestActivity(
    restricted ? undefined : circle.id
  );
  const overdueCount = summary ? Math.max(summary.overdue, summary.not_marked_total) : 0;
  const hasOverdueAlert = !restricted && overdueCount > 0;

  // Mirrors mobile's MedicationSnapshotRow precedence for the medication case:
  // all taken → still some left (including overdue — the small avatar badge
  // above already carries that distinction, so the row's own icon/tone stays
  // plain). Null when there is nothing scheduled today, which HANDS THE STATUS
  // LINE OVER to the activity branch below.
  const allTaken = summary ? summary.total_today > 0 && summary.taken >= summary.total_today : false;
  const medRowLabel =
    summary && summary.total_today > 0
      ? allTaken
        ? t('med.allTaken')
        : t('med.takenToday', { taken: summary.taken, total: summary.total_today })
      : null;

  /**
   * THE STATUS LINE, in precedence order: today's medications → the circle's
   * most recent real activity → "nothing tracked yet".
   *
   * This row used to be medication-only, so 57% of paying circles — the ones
   * with no medications at all — read "No medications today" on every visit
   * forever. That is a dead end dressed as a status: it reports the absence of
   * a feature the household does not use, and there is nothing the card can
   * ever say instead. The activity line replaces it with what the circle
   * actually did.
   */
  const recentActivity =
    latest?.activities.find((entry) => !NON_ACTIVITY_TYPES.has(entry.action_type)) ?? null;
  const activityLabel = recentActivity
    ? `${renderActivityDescription(recentActivity, tActivity, {
        hourCycle,
        // NULL, DELIBERATELY. `timezone` is the CARE RECIPIENT's zone, and
        // GET /circles (this card's only source) does not return one — it
        // lives on GET /circles/:id, which is one extra request PER CARD.
        // renderActivityDescription's case 4 handles null by rendering the
        // server-written description through the legacy phrase translator:
        // still localized, just less specific than the parameterized form.
        // That is the documented trade, and it is the right one here rather
        // than labelling a time with a guessed zone (or paying N requests on
        // a picker for one line of copy).
        timezone: null,
      })} · ${formatRelativeTime(recentActivity.created_at, tActivity)}`
    : null;

  // Hold the Skeleton until whichever query owns the line has answered —
  // otherwise a card flashes "Nothing tracked yet" for one frame before its
  // real activity lands, which reads as a bug about the user's own data.
  const statusPending =
    (medsPending && !summary) || (medRowLabel === null && activityPending && !latest);
  const statusLabel = statusPending
    ? null
    : (medRowLabel ?? activityLabel ?? t('med.nothingTrackedYet'));
  const statusIcon: IconName = medRowLabel
    ? allTaken
      ? 'checkmark-circle'
      : 'medkit-outline'
    : recentActivity
      ? getActivityIcon(recentActivity.action_type)
      : 'ellipse-outline';

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
  // string, never the visible descendant text (the name, the status row, the
  // access badge). So everything a sighted user reads on the card has to be
  // composed into `cardLabel` by hand; nothing here is "extra".
  //
  // It therefore reads `statusLabel`, NOT the medication line: whichever of the
  // three branches owns the row is what a sighted user sees, so it is what the
  // label has to say. Wiring it to the med line alone is how this label went
  // stale the first time.
  //
  // The role status dot and the overdue alert badge are ALSO color-only +
  // aria-hidden (WCAG SC 1.1.1 / 1.4.1) — when overdue, `picker.openWithRoleOverdue`
  // already folds a full taken/total/overdue sentence in, so that branch is
  // self-contained (it describes the alert badge, which is the salient fact on
  // an overdue card); the plain branch appends whichever single line the card
  // itself shows below the name (the access badge's word when restricted,
  // else the status line) with a comma, mirroring how the visible card
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
        restricted ? restrictedLabel : statusLabel,
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

            {/* Status row (mobile's MedicationSnapshotRow, widened past meds)
                — only for circles the user can act on; restricted cards never
                fetch anything at all. */}
            {!restricted && (
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-line-2 pt-3">
                <span className="flex min-w-0 items-center gap-2 text-sm text-ink-2">
                  {statusPending ? (
                    <Skeleton className="h-4 w-32" />
                  ) : (
                    <>
                      <Icon
                        name={statusIcon}
                        size="inline"
                        className={`shrink-0 ${allTaken ? 'text-moss' : 'text-ink-3'}`}
                      />
                      {/* The medication line is short and fixed-shape, so it
                          stays a bare text node (no wrapper). An activity
                          description is arbitrary length — "Confirmed
                          Medication: Hydrochlorothiazide 12.5mg" — and would
                          wrap the card to three lines, so that branch gets a
                          truncating span. */}
                      {medRowLabel ?? <span className="truncate">{statusLabel}</span>}
                    </>
                  )}
                </span>
                <span className={`${roleBadgeClass[roleKey]} shrink-0`}>{roleLabel}</span>
              </div>
            )}
          </div>
        </Card>
      </Link>
    </li>
  );
}
