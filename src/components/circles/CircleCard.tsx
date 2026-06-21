import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, Skeleton, type BadgeVariant } from '@/components/ui';
import type { Circle } from '@/api/circles';
import { useMedicationTodaySummary } from '@/hooks/useMedConfirmation';
import type { MedicationTodaySummary } from '@/api/medicationConfirmations';
import { Analytics } from '@/lib/analytics';
import { EyeIcon, LockIcon, PillIcon, CheckCircleIcon, ClockIcon, AlertCircleIcon } from './icons';

export interface CircleCardProps {
  circle: Circle;
}

type RoleKey = 'owner' | 'caregiver' | 'careRecipient';

const roleBadgeVariant: Record<RoleKey, BadgeVariant> = {
  owner: 'moss',
  careRecipient: 'terracotta',
  caregiver: 'neutral',
};

// Soft status-dot tint on the avatar, by role (mirrors mobile's accent dot).
const roleDotClass: Record<RoleKey, string> = {
  owner: 'bg-moss',
  careRecipient: 'bg-terracotta',
  caregiver: 'bg-dusk',
};

function getRoleKey(circle: Circle): RoleKey {
  if (circle.is_care_recipient) return 'careRecipient';
  return circle.role === 'owner' ? 'owner' : 'caregiver';
}

type MedTone = 'empty' | 'taken' | 'pending' | 'overdue';

interface MedStatus {
  tone: MedTone;
  icon: ReactNode;
  label: string;
  /** True when overdue/unmarked meds warrant the avatar alert badge. */
  alert: boolean;
}

const medToneTextClass: Record<MedTone, string> = {
  empty: 'text-ink-3',
  taken: 'text-moss-deep',
  pending: 'text-clay-deep',
  overdue: 'text-terracotta-deep',
};

/** Derive the snapshot status from the aggregate summary (mirrors mobile's
 *  MedicationSnapshotRow precedence: all-taken → overdue → pending → empty). */
function deriveMedStatus(
  summary: MedicationTodaySummary,
  t: (key: string, opts?: Record<string, unknown>) => string
): MedStatus {
  if (summary.total_today === 0) {
    return { tone: 'empty', icon: <PillIcon />, label: t('med.noMedsToday'), alert: false };
  }

  const allTaken = summary.taken >= summary.total_today;
  const overdueCount = Math.max(summary.overdue, summary.not_marked_total);
  const hasOverdue = overdueCount > 0;

  if (allTaken) {
    return { tone: 'taken', icon: <CheckCircleIcon />, label: t('med.allTaken'), alert: false };
  }
  if (hasOverdue) {
    return {
      tone: 'overdue',
      icon: <AlertCircleIcon />,
      label: t('med.takenOverdue', {
        taken: summary.taken,
        total: summary.total_today,
        overdue: overdueCount,
      }),
      alert: true,
    };
  }
  return {
    tone: 'pending',
    icon: <ClockIcon />,
    label: t('med.takenToday', { taken: summary.taken, total: summary.total_today }),
    alert: false,
  };
}

/**
 * Circle picker card. The whole card is a link to the circle's overview.
 *
 * Non-restricted circles get a "hero" treatment mirroring mobile's
 * CircleListScreen: avatar with a role status dot (+ red alert badge when meds
 * are overdue), name + role badge, a care-first subtitle, and a today's-meds
 * snapshot row below a divider. Restricted circles (`read_only` / `view_only`)
 * stay subdued, skip the meds fetch, and show their access badges instead.
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
  const medStatus = summary ? deriveMedStatus(summary, t) : null;

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

  const surface = restricted
    ? 'border-line-2 bg-bg-2'
    : 'border-line bg-cream hover:border-ink/25 hover:shadow-sm';

  // The role status dot and the overdue alert badge are both color-only +
  // aria-hidden — surface their meaning to AT through the card's link label
  // (WCAG SC 1.1.1 / 1.4.1). Include the role, and when meds are overdue append
  // the meds status (which already carries the counts).
  const roleLabel = t(`roles.${roleKey}`);
  const cardLabel = medStatus?.alert
    ? t('picker.openWithRoleOverdue', {
        name: circle.name,
        role: roleLabel,
        status: medStatus.label,
      })
    : t('picker.openWithRole', { name: circle.name, role: roleLabel });

  return (
    <li className="list-none">
      <Link
        to={`/circles/${circle.id}`}
        aria-label={cardLabel}
        onClick={() => Analytics.circleViewed(circle.id)}
        data-restricted={restricted || undefined}
        className={`group block h-full rounded-2xl border p-5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss-deep ${surface}`}
      >
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Avatar size="md" name={circle.recipient_name} photoUrl={circle.recipient_photo_url} />
            {/* Role status dot */}
            <span
              aria-hidden="true"
              className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-cream ${restricted ? 'bg-bg-3' : roleDotClass[roleKey]}`}
            />
            {/* Overdue alert badge — solid deep-terracotta dot with a bold "!"
                (the badge IS the circle, so the glyph is just the exclamation,
                not AlertCircleIcon's competing outline). */}
            {medStatus?.alert && (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-cream bg-terracotta-deep text-cream shadow-sm"
              >
                <svg
                  width={12}
                  height={12}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                  strokeLinecap="round"
                >
                  <path d="M12 6.5v7" />
                  <path d="M12 17.5h.01" />
                </svg>
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="serif m-0 break-words text-lg leading-snug text-ink line-clamp-2">
              {circle.name}
            </h2>
            <p className="mt-0.5 truncate text-sm text-ink-2">{subtitle}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-line-2 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            {restricted ? (
              <>
                {isReadOnly && (
                  <Badge variant="neutral">
                    <LockIcon />
                    {t('access.readOnly')}
                  </Badge>
                )}
                {isViewOnly && (
                  <Badge variant="neutral">
                    <EyeIcon />
                    {t('access.viewOnly')}
                  </Badge>
                )}
              </>
            ) : medsPending && !medStatus ? (
              <Skeleton className="h-4 w-32" />
            ) : medStatus ? (
              <span
                className={`flex min-w-0 items-center gap-1.5 text-sm font-medium ${medToneTextClass[medStatus.tone]}`}
              >
                <span className="shrink-0">{medStatus.icon}</span>
                <span className="truncate">{medStatus.label}</span>
              </span>
            ) : (
              // Summary failed to load — degrade quietly to the neutral glyph.
              <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink-3">
                <span className="shrink-0">
                  <PillIcon />
                </span>
                <span className="truncate">{t('med.noMedsToday')}</span>
              </span>
            )}
          </div>

          <Badge variant={roleBadgeVariant[roleKey]} className="shrink-0">
            {t(`roles.${roleKey}`)}
          </Badge>
        </div>
      </Link>
    </li>
  );
}
